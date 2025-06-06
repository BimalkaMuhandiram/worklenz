import { ChatCompletionMessageParam } from "openai/resources";

// Defines allowed prompt types used by the app
type PromptType = "system" | "query" | "response" | "few-shot" | "cot" | "hybrid" | "sql-query" | "sql-result";

interface PromptInput {
  type: PromptType;
  data: any; // input data needed to build the prompt
  examples?: { user: string; assistant: string }[]; // for few-shot learning
}

export class PromptBuilder {
  static build(input: PromptInput): ChatCompletionMessageParam {
    switch (input.type) {
      case "system":
        return this.buildSystemPrompt(input.data);
      case "query":
        return this.buildQueryPrompt(input.data.schema, input.data.teamId);
      case "response":
        return this.buildResponsePrompt(input.data);
      case "few-shot":
        return this.buildFewShotPrompt(input.data, input.examples || []);
      case "cot":
        return this.buildChainOfThoughtPrompt(input.data);
      case "hybrid":
        return this.buildHybridPrompt(input.data);
      case "sql-query":
        return this.buildSQLQueryPrompt(input.data);
      case "sql-result":
        return this.buildAnswerFromResultsPrompt(input.data);
      default:
        throw new Error(`Unsupported prompt type: ${input.type}`);
    }
  }

  static buildSystemPrompt(data: any): ChatCompletionMessageParam {
    const jsonStr = JSON.stringify(data, null, 2);
    return {
      role: "system",
      content: `
You are a smart assistant for the Worklenz project management platform. Help users manage tasks, timelines, and team collaboration using natural conversation.

## Context
\\\ json
${jsonStr}
\\\

## Responsibilities
- Understand various user message types (updates, summaries, questions, assignments).
- Clarify vague queries.
- Offer relevant follow-up actions.
- Interpret casual phrases (e.g., “next week”, “yesterday”).

## Format
- Use markdown.
- Use \\backticks\\ for task names, people, dates.
- Never expose raw JSON or internal IDs.

Respond clearly and use a helpful, confident tone.
      `.trim(),
    };
  }

  static buildHybridPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are an intelligent assistant for Worklenz. Analyze the user's input and determine the most likely intent: query, update, create, or summarize.

## Context
\\\json
${JSON.stringify(data.context || {}, null, 2)}
\\\

## Instructions
- If user asks a question: respond based on provided data.
- If user gives an update: confirm before applying.
- If unclear, ask a clarifying question.

## Output
Reply in markdown. Keep responses concise, with clear action suggestions.
      `.trim(),
    };
  }

  static buildQueryPrompt(schema: string, teamId: string): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a database-aware assistant. Translate natural queries into PostgreSQL SELECT using the schema.

## Schema
\\\
${schema}
\\\

- Only generate SELECT queries.
- Add \\in_organization(team_id, '${teamId}')\\.
- LIMIT 100. Skip ID, color fields.

Return:
\\\ json
{
  "summary": "...",
  "query": "...",
  "is_query": true|false
}
\\\
      `.trim(),
    };
  }

  static buildResponsePrompt(dataList: string): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a project assistant. Use the provided data to answer the user's question.

## Data
\\\ json
${dataList}
\\\

## Rules
- Summarize results.
- Highlight overdue or high-priority items.
- Offer to assist further (e.g., update deadline?).
- Limit to 10 results. Use \\backticks\\ for names/dates.

Say "No data found" if empty.
      `.trim(),
    };
  }

  static buildFewShotPrompt(
    data: any,
    examples: { user: string; assistant: string }[]
  ): ChatCompletionMessageParam {
    const formattedExamples = examples
      .map((e) => `User: ${e.user}\nAssistant: ${e.assistant}`)
      .join("\n\n");

    return {
      role: "system",
      content: `
You are a helpful project management assistant. Follow the patterns shown in examples.

## Examples:
${formattedExamples}

## Current Message:
User: ${data.query}
      `.trim(),
    };
  }

  static buildChainOfThoughtPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
Let's reason this through.

## Context
\\\ json
${JSON.stringify(data, null, 2)}
\\\

1. Understand the request.
2. Identify user intent (ask/update/assign).
3. Check for missing info.
4. Respond clearly and suggest next steps.
      `.trim(),
    };
  }

  static buildSQLQueryPrompt(data: {
    userMessage: string;
    schema: any;
    userId: string;
    teamId: string;
  }): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a SQL assistant. Based on the schema and user message, generate a PostgreSQL SELECT query.

## Schema
\\\ json
${JSON.stringify(data.schema, null, 2)}
\\\

## Message
"${data.userMessage}"

## Context
- Only generate SELECT queries.
- Use team_id = '${data.teamId}' if needed.
- Use user_id = '${data.userId}' if relevant.
- Wrap all output in JSON like:
{
  "intent": "List user's ongoing projects",
  "query": "SELECT name FROM Projects WHERE status = 'ongoing' AND user_id = '${data.userId}'"
}
      `.trim(),
    };
  }

  static buildAnswerFromResultsPrompt(data: {
    userMessage: string;
    queryResult: any[];
  }): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a helpful assistant. Turn the database result into a user-friendly summary.

## Original Question
"${data.userMessage}"

## Query Result
\\\ json
${JSON.stringify(data.queryResult, null, 2)}
\\\

If the result is empty, say "No data found."
Otherwise, summarize clearly in markdown using bullet points or tables if appropriate.
      `.trim(),
    };
  }
}
