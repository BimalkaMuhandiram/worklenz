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

## Examples of clarifications
User: "Show me tasks by Andrew."
Assistant: "Do you want tasks assigned to Andrew or created by Andrew? Also, which project or team should I look at?"

User: "What is the status?"
Assistant: "Could you please specify which task or project you are referring to?"

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

  static buildResponsePrompt(data: { items: any[]; teamId: string }): ChatCompletionMessageParam {
  const { items, teamId } = data;

  const filteredItems = Array.isArray(items)
    ? items.filter(item => String(item.team_id) === String(teamId))
    : [];

  return {
    role: "system",
    content: `
You are a project assistant. Use the provided data to answer the user's question.

## Data
\`\`\`json
${JSON.stringify(filteredItems.slice(0, 10), null, 2)}
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
    // If no examples provided, add default few-shot examples
    if (examples.length === 0) {
      examples = [
        {
          user: "Show me all tasks assigned to John in project Alpha.",
          assistant: `{
  "summary": "Tasks assigned to John in project Alpha",
  "query": "SELECT * FROM tasks WHERE assignee = 'John' AND project_name = 'Alpha' AND team_id = '...' LIMIT 100",
  "is_query": true
}`
        },
        {
          user: "List overdue tasks.",
          assistant: `{
  "summary": "Overdue tasks",
  "query": "SELECT * FROM tasks WHERE due_date < CURRENT_DATE AND status != 'completed' AND team_id = '...' LIMIT 100",
  "is_query": true
}`
        },
      ];
    }

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
\`\`\`json
${JSON.stringify(data.schema, null, 2)}
\`\`\`

## User Message
"${data.userMessage}"

## Guidelines
- Only generate SELECT queries.
- Use only valid table aliases. Never reference aliases that are not explicitly defined in the FROM or JOIN clauses.
- Do not make up table or column names — strictly use what's in the schema.
- For UUID columns like project_id, team_id, user_id:
  - If filtering by name, use subqueries to resolve UUIDs, e.g.:
    \`project_id = (SELECT id FROM projects WHERE name = 'Project Name')\`
- Ensure JOINs have valid relationships as per the schema.
- Limit results to 100 rows.
- Never generate DROP/INSERT/UPDATE/DELETE queries.

## Output Format
Respond with JSON:
\`\`\`json
{
  "intent": "...",
  "query": "SELECT ..."
}
\`\`\`

Make sure the SQL is syntactically valid and safe to run. Use proper table aliases and JOIN logic.
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
- If the query was invalid or failed, say: "Sorry, I couldn't retrieve data. Please check your request."
- Otherwise, summarize clearly in markdown.
- Use bullet points or tables where appropriate.
- Highlight key findings and offer to help with follow-up.
- If any field has no data (null, empty string, empty array), omit it from the summary entirely instead of mentioning missing details.
      `.trim(),
    };
  }
}
