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
  | "enhanced-response"; // Added new prompt type for enhanced responses

export interface PromptInput {
  type: PromptType;
  data: any;
  examples?: ReadonlyArray<{ user: string; assistant: string }>;
}

export class PromptBuilder {
  static async build(input: PromptInput): Promise<ChatCompletionMessageParam> {
    switch (input.type) {
      case "system":
        return this.buildSystemPrompt(input.data);
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
    fullSchemaDescriptions: string[]
  ): Promise<string> {
    const userEmbedding = await OpenAIService.getEmbedding(userMessage);
    const schemaEmbeddings = await OpenAIService.getBatchEmbeddings(fullSchemaDescriptions);
    const scored = schemaEmbeddings.map((emb, idx) => ({
      score: OpenAIService.cosineSimilarity(userEmbedding, emb),
      text: fullSchemaDescriptions[idx],
    }));
    scored.sort((a, b) => b.score - a.score);
    const topRelevant = scored.slice(0, 3).map((s) => s.text).join("\n\n");
    return topRelevant;
  }

  // More empathetic, proactive system prompt
  static buildSystemPrompt(data: any): ChatCompletionMessageParam {
    return {
      role: "system",
      content: `
You are a highly intelligent, empathetic assistant for the Worklenz project management platform.
Help users manage tasks, timelines, and team collaboration using natural, conversational language.

## Context
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

## Responsibilities
- Understand diverse user intents (updates, summaries, questions, assignments, clarifications).
- Proactively clarify vague or ambiguous queries politely.
- Offer relevant suggestions and follow-up actions.
- Interpret casual, relative phrases like "next week", "yesterday", or "ASAP".
- Use a friendly, confident tone that instills trust and clarity.

## Format
- Use markdown formatting.
- Use \`backticks\` for task names, people, and dates.
- Never expose raw JSON or internal IDs.
- If unsure, ask clarifying questions before answering.

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
    fullSchemaDescriptions: string[]
  ): Promise<ChatCompletionMessageParam> {
    const relevantSchemaInfo = await this.enrichSchemaWithRelevantInfo(userMessage, fullSchemaDescriptions);

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
- If unsure, refer to the full schema to determine correct table references.

Example:
Bad: WHERE team_id = '...'
Good: WHERE p.team_id = '...'
`;

    return {
      role: "system",
      content: `
You are a database-aware assistant. Translate natural language into a PostgreSQL SELECT query using the provided schema and relevant context.

## Relevant Schema Info (most relevant parts)
${relevantSchemaInfo}

## Full Schema
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

${statusFilterNote}

${disambiguationNote}

## Additional Notes:
- Always filter all results by team_id = '${teamId}'.
- Some tables (e.g., tasks) do not have team_id directly.
- For such tables, join related tables (e.g., projects) to apply the team filter.
- Use only valid table and column names from the schema.
- Limit results to 100 rows.
- Do not include internal metadata fields like \`id\`, \`color\`, unless requested.

Return JSON in the following format:
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

  // Convert SQL result to human-readable summary with enhancements
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
        {
          user: "What tasks were completed last week?",
          assistant: `{
  "summary": "Tasks completed last week",
  "query": "SELECT t.* FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.completed_date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE AND p.team_id = '...' LIMIT 100",
  "is_query": true
}`,
        },
        {
          user: "Create a new task 'Prepare presentation' assigned to Alice.",
          assistant: `{
  "summary": "Create task 'Prepare presentation' assigned to Alice",
  "query": "INSERT INTO tasks (name, assignee, project_id) VALUES ('Prepare presentation', 'Alice', (SELECT id FROM projects WHERE name = '...' LIMIT 1))",
  "is_query": false
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
## Database Schema
\`\`\`json
${JSON.stringify(data.schema, null, 2)}
\`\`\`

## Team ID: '${data.teamId}'

${statusFilterNote}

${disambiguationNote}

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