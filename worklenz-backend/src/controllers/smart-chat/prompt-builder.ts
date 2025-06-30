import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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
  data: any;
  examples?: ReadonlyArray<{ user: string; assistant: string }>;
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
        return this.buildFewShotPrompt(input.data, input.examples ?? []);
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

  // Set up assistant behavior and tone
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

  // Handle unclear or multi-intent queries
  static buildHybridPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are an intelligent assistant for Worklenz. Analyze the user's input and determine the most likely intent: query, update, create, or summarize.

## Context
\`\`\`json
${JSON.stringify(data.context ?? {}, null, 2)}
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

  // Convert natural language into SQL
  static buildQueryPrompt(schema: any, teamId: string): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a database-aware assistant. Translate natural language into a PostgreSQL SELECT query using the provided schema.

## Schema
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## Notes:
- Filter all results by team_id = '${teamId}'.
- Some tables (e.g., tasks) may not have team_id directly.
- For such tables, join related tables (e.g., projects) to filter by team.
- Use valid table and column names only.
- Limit results to 100 rows.
- Skip internal or irrelevant fields like id, color.

Return JSON with:
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

  // Convert SQL result to human response
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
- Limit output to the top 10 results.
- Use \`backticks\` for names and dates.

Say "No data found" if the list is empty.
      `.trim(),
    };
  }

  // Demonstrate examples for better query generation
  static buildFewShotPrompt(
    data: any,
    examples: ReadonlyArray<{ user: string; assistant: string }>
  ): ChatCompletionMessageParam {
    if (examples.length === 0) {
      examples = [
        {
          user: "Show me all tasks assigned to John in project Alpha.",
          assistant: `{
  "summary": "Tasks assigned to John in project Alpha",
  "query": "SELECT t.* FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.assignee = 'John' AND p.name = 'Alpha' AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`,
        },
        {
          user: "List overdue tasks.",
          assistant: `{
  "summary": "Overdue tasks",
  "query": "SELECT t.* FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.due_date < CURRENT_DATE AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`,
        },
      ];
    }

    const fewShotText = examples
      .map(
        (ex) =>
          `User: ${ex.user}
Assistant: \`\`\`json
${ex.assistant}
\`\`\``
      )
      .join("\n\n");

    return {
      role: "system",
      content: `
You will receive a user query. Translate it into a SQL SELECT query filtered by team_id.

## Examples
${fewShotText}

Now convert the following user query:
"${data.userMessage}"
      `.trim(),
    };
  }

  // Break down reasoning steps
  static buildChainOfThoughtPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a reasoning assistant. Break down the user's query into logical steps.

User message: "${data.userMessage}"

Explain how you would answer this with SQL or data lookups.
      `.trim(),
    };
  }

  // 	Create SQL with schema and user context
  static buildSQLQueryPrompt(data: {
    userMessage: string;
    userId: string;
    teamId: string;
    schema: any;
  }): ChatCompletionMessageParam {
    return {
      role: "user",
      content: `
## Database Schema
\`\`\`json
${JSON.stringify(data.schema, null, 2)}
\`\`\`

## Team ID: '${data.teamId}'

## Important notes:
- The "tasks" table does NOT have a "team_id" column.
- To filter tasks by team, join tasks.project_id = projects.id and filter projects.team_id = '${data.teamId}'.
- Always restrict data access to team_id = '${data.teamId}' (directly or via join).
- Use only tables and columns from the schema.
- Limit results to 100 rows.

## User query:
"${data.userMessage}"

## Output format (JSON):
{
  "summary": "Short description of query",
  "query": "SQL SELECT query string",
  "is_query": true
}
      `.trim(),
    };
  }

  // 	Turn query output into human insight
  static buildAnswerFromResultsPrompt(data: {
    userMessage: string;
    queryResult: any[];
  }): ChatCompletionMessageParam {
    return {
      role: "user",
      content: `
Given the user message:
"${data.userMessage}"

And the following query result data (JSON):
\`\`\`json
${JSON.stringify(data.queryResult, null, 2)}
\`\`\`

Summarize the data clearly and helpfully. 

Respond in markdown using backticks \` for names and dates.
      `.trim(),
    };
  }
}
