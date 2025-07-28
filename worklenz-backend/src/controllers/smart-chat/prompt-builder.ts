import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { OpenAIService } from "./openai-service";

export type PromptType =
  | "system"
  | "query"
  | "response"
  | "few-shot"
  | "cot"
  | "hybrid"
  | "sql-query"
  | "sql-result"
  | "enhanced-response"; 

export interface PromptInput {
  type: PromptType;
  data: any;
  examples?: ReadonlyArray<{ user: string; assistant: string }>;
}

function secondsToReadableTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export class PromptBuilder {
  static async build(input: PromptInput): Promise<ChatCompletionMessageParam> {
    switch (input.type) {
      case "system":
        const userTeamIds = input.data.userTeamIds || [];
        return this.buildSystemPrompt(input.data, userTeamIds);
      case "query":
        return await this.buildQueryPrompt(
          input.data.schema,
          input.data.teamId,
          input.data.userMessage,
          input.data.fullSchemaDescriptions
        );
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
      case "enhanced-response": 
        return this.buildEnhancedResponsePrompt(input.data);
      default:
        // fallback prompt instead of throwing
        return {
          role: "system",
          content: `Unsupported prompt type: "${input.type}". Please provide a valid prompt type such as "query", "response", or "system".`,
        };
    }
  }

  // Enrich schema with closest relevant schema info using embeddings
  private static async enrichSchemaWithRelevantInfo(
  userMessage: string,
  fullSchemaDescriptions: any[] // now expect schema as array of table objects with columns
): Promise<string> {
  // Build detailed descriptions with table names, aliases, and columns
  const detailedDescriptions = fullSchemaDescriptions.map((table) => {
    // Assume each table has: { name, alias, columns: { colName: colType, ... } }
    const columnsText = Object.entries(table.columns || {})
      .map(([col, type]) => `- \`${col}\`: ${type}`)
      .join("\n");

    return `### Table: ${table.name} (alias \`${table.alias}\`)\n${columnsText}`;
  });

  // Get embeddings for each detailed description
  const schemaEmbeddings = await OpenAIService.getBatchEmbeddings(detailedDescriptions);

  // Get embedding for user message
  const userEmbedding = await OpenAIService.getEmbedding(userMessage);

  // Calculate similarity scores
  const scored = schemaEmbeddings.map((emb, idx) => ({
    score: OpenAIService.cosineSimilarity(userEmbedding, emb),
    text: detailedDescriptions[idx],
  }));

  // Sort by relevance
  scored.sort((a, b) => b.score - a.score);

  // Take top 3 most relevant table descriptions
  const topRelevant = scored.slice(0, 3).map((s) => s.text).join("\n\n");

  return topRelevant;
}

  // More empathetic, proactive system prompt
  static buildSystemPrompt(data: any, userTeamIds: string[]): ChatCompletionMessageParam {
  return {
    role: "system",
    content: `
You are a highly intelligent, empathetic assistant for the Worklenz project management platform.
Help users manage tasks, timelines, and team collaboration using natural, conversational language.

## Context
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

## Schema Reference
You can only use the following tables and columns:

- tasks(id, title, start_date, completed_at, project_id)
- projects(id, name, team_id)
- teams(id, name)
- user_team(user_id, team_id)

To get team information related to a task, **you MUST JOIN through the \`projects\` table** using \`projects.team_id\`.

 \`tasks.team_id\` does **not exist**. Never use it.

## Data Access Rules
- The user is only authorized to access these team IDs:
  \`\`\`ts
  ${JSON.stringify(userTeamIds)}
  \`\`\`
- All queries and logic must be scoped to **only** these team IDs.
- NEVER expose internal IDs like task IDs, team IDs, or raw UUIDs in the response.
- Do NOT guess or invent table or column names.

## Responsibilities
- Understand diverse user intents (updates, summaries, questions, assignments, clarifications).
- Proactively clarify vague or ambiguous queries politely.
- Offer relevant suggestions and follow-up actions.
- Interpret casual, relative phrases like "next week", "yesterday", or "ASAP".
- Use a friendly, confident tone that instills trust and clarity.

## Format
- Use markdown formatting.
- Use \`backticks\` for task names, people, and dates.
- Return only the relevant insights — **not raw SQL**, **not internal IDs**.
- If unsure, ask clarifying questions.

Respond clearly and helpfully, guiding the user where needed.
    `.trim(),
  };
}

  // Improved hybrid prompt with richer examples and intent detection
  static buildHybridPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are an intelligent assistant for Worklenz. Analyze the user's input carefully to determine their intent:
- Query (requesting info)
- Update (changing data)
- Create (adding new tasks or projects)
- Summarize (overview or status)

## Context
\`\`\`json
${JSON.stringify(data.context ?? {}, null, 2)}
\`\`\`

## Instructions
- If user asks a question: respond factually with relevant data.
- If user gives an update: confirm details before applying.
- If user wants to create something: validate inputs and summarize confirmation.
- If input is ambiguous or has multiple intents: ask clarifying questions.

## Clarification Examples
User: "Show me tasks by Andrew."
Assistant: "Do you want tasks assigned to Andrew or created by Andrew? Also, which project or team should I look at?"

User: "What is the status?"
Assistant: "Could you please specify which task or project you are referring to?"

User: "Create a task 'Prepare report'."
Assistant: "When is the deadline for 'Prepare report'? Who should be assigned?"

## Output
Reply in markdown. Keep responses concise and include actionable suggestions.
      `.trim(),
    };
  }

  // New prompt for enhancing any kind of user response with empathy, clarity, and follow-ups
  static buildEnhancedResponsePrompt(data: { userMessage: string; previousResponse?: string }): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are an assistant refining responses for diverse user inputs.

User message:
"${data.userMessage}"

${data.previousResponse ? `Previous assistant response:
${data.previousResponse}\n` : ""}

Instructions:
- Make the response clear, friendly, and engaging.
- If the input is ambiguous or incomplete, ask polite clarifying questions.
- Anticipate possible user needs and suggest helpful next steps.
- Use markdown with \`backticks\` for key terms.
- Keep responses concise but informative.

If the user query is complex or multi-part, break down the response into clear sections.
      `.trim(),
    };
  }

  // Convert natural language into SQL with enriched context
  static async buildQueryPrompt(
  schema: any,
  teamId: string,
  userMessage: string,
  fullSchemaDescriptions: any[]
): Promise<ChatCompletionMessageParam> {
  const relevantSchemaInfo = await this.enrichSchemaWithRelevantInfo(userMessage, fullSchemaDescriptions);

  const joinUserNameNote = `
## How to get team member names:
- The \`team_members\` table does NOT contain name columns.
- To get names, join \`team_members.user_id = users.id\` and use \`users.full_name\` or \`users.name\`.
- Use alias \`tm\` for \`team_members\`, \`u\` for \`users\`.
`;

  const statusFilterNote = `
## Filtering by status:
- The \`status_id\` column refers to \`sys_project_statuses.id\`.
- To filter by status name (e.g. 'Completed'), use:
  AND status_id = (SELECT id FROM sys_project_statuses WHERE name = 'Completed')
`;

  const teamFilterNote = `
## Filtering by team:
- NOT all tables have a \`team_id\` column.
- NEVER assume \`team_id\` exists on \`tasks\` or \`team_members\`.
- Instead, JOIN related tables like \`projects\` and apply \`team_id\` filter there:
  Example: JOIN projects p ON t.project_id = p.id WHERE p.team_id = '${teamId}'
`;

  const disambiguationNote = `
## Column usage:
- Always qualify columns with table aliases (e.g., \`t.end_date\`, \`p.team_id\`).
- Avoid using columns that do not exist.
- Use aliases consistently: \`t\` = tasks, \`p\` = projects, \`u\` = users, \`tm\` = team_members.
`;

  return {
    role: "system",
    content: `
You are a SQL assistant. Translate natural language into a valid PostgreSQL SELECT query using the schema below.

## WARNING
- NEVER include any IDs (user IDs, team IDs, task IDs) in your response.
- Use names only (e.g., user full names, project names, task names).
- ONLY use tables and columns explicitly listed in the schema below.
- Do NOT guess or make up table names or column names.
- If a column or table is missing, ask for clarification.

## Common Mistakes to Avoid
- Referencing \`tasks.team_id\` — this column does NOT exist.
- Using \`team_members.name\` — use a JOIN with \`users\` to get names.
- Referencing \`task_status_categories\` — this table does NOT exist.
- Use JOINs and aliases exactly as shown below.

## Relevant Schema
${relevantSchemaInfo}

${joinUserNameNote}

${teamFilterNote}

${statusFilterNote}

${disambiguationNote}

## Full Schema
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## Output Format
\`\`\`json
{
  "summary": "...",
  "query": "...",
  "is_query": true
}
\`\`\`

## Instructions
- Only use columns and tables that exist.
- Always apply \`team_id = '${teamId}'\` by JOINING the appropriate table (e.g., \`projects\`).
- Never filter on non-existent columns like \`t.team_id\` or \`tm.name\`.
- Limit result rows to 100.
- Avoid subqueries unless necessary.

## Natural Language User Request
"${userMessage}"

## Clarify If Needed
If the task is unclear or ambiguous (e.g., missing assignee, project, or status), ask for clarification instead of guessing.

If you understand the task, proceed to generate a query and summary.

    `.trim(),
  };
}

  // Convert SQL result to human-readable summary with enhancements
  static buildResponsePrompt(data: { items: any[]; teamId: string }): ChatCompletionMessageParam {
  const { items, teamId } = data;

  const filteredItems = Array.isArray(items)
  ? items.filter(item => String(item.team_id) === String(teamId))
  : [];

const sanitizedItems = filteredItems.map(item => {
  const copy = { ...item };
  delete copy.owner_id;
  delete copy.status_id;
  delete copy.team_id;
  delete copy.id;
  delete copy.project_id;
  return copy;
});

const readableItems = sanitizedItems.map(item => ({
  ...item,
  avg_completion_time: item.avg_completion_time
    ? secondsToReadableTime(item.avg_completion_time)
    : undefined,
}));

  const timestamp = new Date().toISOString();

  return {
    role: "system",
    content: `
You are a project assistant. Use the provided data to answer the user's question.

## Generated At
\`${timestamp}\`

## Data
\`\`\`json
${JSON.stringify(readableItems.slice(0, 10), null, 2)}
\`\`\`

## Instructions
- Summarize the results clearly and helpfully.
- Highlight overdue or high-priority items.
- Mention if no data was found.
- Limit output to the top 10 results.
- Use \`backticks\` for names and dates.

If the list is empty, say "No data found".
    `.trim(),
  };
}

  // few-shot examples with more diverse queries
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
  "query": "SELECT t.id, t.name AS task_name, t.due_date, u.name AS assignee_name, p.name AS project_name FROM tasks t JOIN users u ON t.assignee = u.id JOIN projects p ON t.project_id = p.id WHERE u.name = 'John' AND p.name = 'Alpha' AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`
  },
  {
    user: "List tasks due this week assigned to John for project Beta.",
    assistant: `{
  "summary": "Tasks due this week assigned to John in project Beta",
  "query": "SELECT t.id, t.name AS task_name, t.due_date, u.name AS assignee_name, p.name AS project_name FROM tasks t JOIN users u ON t.assignee = u.id JOIN projects p ON t.project_id = p.id WHERE u.name = 'John' AND p.name = 'Beta' AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`
  },
  {
    user: "What tasks were completed last week?",
    assistant: `{
  "summary": "Tasks completed last week",
  "query": "SELECT t.id, t.name AS task_name, t.completed_date, p.name AS project_name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.completed_date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`
  },
  {
    user: "What tasks are overdue?",
    assistant: `{
  "summary": "Overdue tasks for the team",
  "query": "SELECT t.id, t.name AS task_name, t.due_date, p.name AS project_name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.due_date < CURRENT_DATE AND t.status != 'completed' AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`
  },
  {
    user: "Tasks assigned to Emily for this week",
    assistant: `{
  "summary": "Emily's tasks due this week",
  "query": "SELECT t.id, t.name AS task_name, t.due_date, u.name AS assignee_name, p.name AS project_name FROM tasks t JOIN users u ON t.assignee = u.id JOIN projects p ON t.project_id = p.id WHERE u.name = 'Emily' AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`
  }
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
You are an AI that converts user queries into SQL SELECT statements related to tasks, users, and projects in a project management system.

Use this database schema:
- tasks(id, name, assignee_id, due_date, completed_date, status, project_id)
- users(id, name)
- projects(id, name, team_id)

Rules:
- Every SQL query must include "p.team_id = '...'" in the WHERE clause. Do not skip this.
- When filtering by assignee, use u.name = 'John' (not ID).
- Assume user-provided names are stored in users.name.
- Use correct JOINs to connect tasks, users, and projects.
- Return only a JSON response with: summary, query, and is_query = true/false

## Examples
${fewShotText}

Now convert the following user query:
"${data.userMessage}"
`.trim()
    };
  }

  // chain-of-thought with more explicit reasoning steps prompt
  static buildChainOfThoughtPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a reasoning assistant. Break down the user's query into clear, logical steps.

User message: "${data.userMessage}"

Explain step-by-step how you would translate this into SQL or data lookups.

Highlight any assumptions and potential ambiguities, and how you would verify them.
      `.trim(),
    };
  }

  // Create SQL with schema and user context (same as original)
  static buildSQLQueryPrompt(data: {
  userMessage: string;
  userId: string;
  teamId: string;
  schema: any;
}): ChatCompletionMessageParam {
  const joinUsersNote = `
## Important note about team member names:
- The \`team_members\` table does NOT have a \`name\` column.
- To filter or select user names, JOIN the \`users\` table using \`team_members.user_id = users.id\`.
- Use alias \`tm\` for \`team_members\` and \`u\` for \`users\`.
- Refer to user names as \`u.name\`, NOT \`tm.name\`.
- NEVER use \`tm.name\`.
`;

  const statusFilterNote = `
## Important notes about filtering by status:
- The column \`status_id\` is a UUID referencing \`sys_project_statuses.id\`.
- Do NOT compare \`status_id\` directly to strings like 'completed' or 'in progress'.
- Instead, filter by joining or subquerying the status table, for example:
  AND status_id = (SELECT id FROM sys_project_statuses WHERE name = 'Completed')
- Only use tables that exist in the schema. The table \`task_status_categories\` does NOT exist.
`;

  const disambiguationNote = `
## Column Qualification Rules:
- Always qualify ambiguous columns using table aliases (e.g., \`t.team_id\`, \`p.team_id\`, \`tm.team_id\`).
- Never use unqualified column names like \`team_id\` if multiple tables contain it.
- Use consistent aliases: \`t\` for \`tasks\`, \`p\` for \`projects\`, \`tm\` for \`team_members\`, \`u\` for \`users\`, etc.
- Refer to the full schema below to avoid ambiguity.
`;

  return {
    role: "user",
    content: `
## WARNING
- Use only columns and tables explicitly shown in the schema.
- NEVER use \`tm.name\`; always join \`users u\` to get user names.
- If uncertain, return an error or ask for clarification.

${joinUsersNote}

${statusFilterNote}

${disambiguationNote}

## Database Schema
\`\`\`json
${JSON.stringify(data.schema, null, 2)}
\`\`\`

## Team ID: '${data.teamId}'

## Additional Notes:
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

  // Turn query output into human insight (same as original)
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