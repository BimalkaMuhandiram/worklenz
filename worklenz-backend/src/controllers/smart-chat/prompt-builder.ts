import { ChatCompletionMessageParam } from "openai/resources";

// Defines allowed prompt types used by the app
type PromptType =
  | "system"
  | "query"
  | "response"
  | "few-shot"
  | "cot"
  | "hybrid"
  | "sql-query"
  | "sql-result";

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
    return {
      role: "system",
      content: `
You are a smart assistant for the Worklenz project management platform. Help users manage tasks, timelines, and team collaboration using natural conversation.

## Context
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

## Responsibilities
- Understand various user message types (updates, summaries, questions, assignments).
- Clarify vague queries.
- Offer relevant follow-up actions.
- Interpret casual phrases (e.g., “next week”, “yesterday”).

## Format
- Use markdown.
- Use \`backticks\` for task names, people, and dates.
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
\`\`\`json
${JSON.stringify(data.context || {}, null, 2)}
\`\`\`

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
You are a database-aware assistant. Translate natural language into a PostgreSQL SELECT query using the provided schema.

## Schema
\`\`\`
${schema}
\`\`\`

- Only generate SELECT queries.
- Ensure the WHERE clause includes: \`in_organization(team_id, '${teamId}')\`
- LIMIT results to 100.
- Skip internal or irrelevant fields like id, color.

Return:
\`\`\`json
{
  "summary": "...",
  "query": "...",
  "is_query": true | false
}
\`\`\`
      `.trim(),
    };
  }

  static buildResponsePrompt(dataList: string): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a project assistant. Use the provided data to answer the user's question.

## Data
\`\`\`json
${dataList}
\`\`\`

## Instructions
- Summarize the results clearly.
- Highlight overdue or high-priority items.
- Suggest helpful next actions (e.g., update a deadline).
- Limit output to the top 10 results.
- Use \`backticks\` for names and dates.

Say "No data found" if the list is empty.
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
You are a helpful project management assistant. Follow the pattern of the examples below.

## Examples
${formattedExamples}

## Current Message
User: ${data.query}
      `.trim(),
    };
  }

  static buildChainOfThoughtPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
Let's reason through the following task.

## Context
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

1. Understand the user request.
2. Identify the intent (question, update, assign, etc.).
3. Look for missing or ambiguous information.
4. Respond in clear steps and suggest next actions.
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
You are a PostgreSQL SQL assistant. Generate a SELECT query based on the schema and user message.

## Schema
\\\json
${JSON.stringify(data.schema, null, 2)}
\\\

## User Message
"${data.userMessage}"

## Guidelines
- Only generate **SELECT** queries.
- Before using a column in WHERE clause, **make sure it exists** in the relevant table.
- If the table includes \`team_id\`, filter by: \`team_id = '${data.teamId}'\`.
- If the table includes \`user_id\`, filter by: \`user_id = '${data.userId}'\`.
- Avoid using columns like \`color\`, \`internal_id\`, etc., unless explicitly requested.
- Limit results to 100 rows.
- Never use DROP/INSERT/UPDATE/DELETE.

## Output Format
Respond with JSON:
\`\`\`json
{
  "intent": "Summarize overdue tasks by owner",
  "query": "SELECT ..."
}
\`\`\`

Make sure the SQL query is valid and safe to run.
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
You are a helpful assistant. Convert the SQL query result into a human-readable summary.

## User Question
"${data.userMessage}"

## Query Result
\`\`\`json
${JSON.stringify(data.queryResult, null, 2)}
\`\`\`

## Instructions
- If the result is empty, say: "No data found."
- Otherwise, summarize clearly in markdown.
- Use bullet points or tables where appropriate.
- Highlight key findings and offer to help with follow-up.
      `.trim(),
    };
  }
}
