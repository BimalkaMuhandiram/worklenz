import db from "../../config/db";
import ReportingControllerBase from "../reporting/reporting-controller-base";
import { OpenAIService } from "./openai-service";
import { PromptBuilder } from "./prompt-builder";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AppError } from "../../utils/AppError";
import { validateSqlQuery } from "../../utils/sqlValidator";

type CachedSchema = {
  timestamp: number;
  schema: string;
};

export default class SmartChatControllerBase extends ReportingControllerBase {
  // Cache schema for 10 minutes to avoid repeated DB hits
  private static schemaCache: CachedSchema | null = null;
  private static readonly SCHEMA_CACHE_TTL = 10 * 60 * 1000;

  protected static getOpenAiClient() {
    return OpenAIService.getClient();
  }

  protected static async getSystemPrompt(data: any): Promise<ChatCompletionMessageParam> {
  const context = {
    userId: data?.userId,
    teamId: data?.teamId,
    projectName: data?.projectName,
    role: data?.role,
    purpose: "Assist with project-related queries using company data.",
  };

  // Fetch the user's team IDs from your DB
  const teamQuery = `
    SELECT team_id 
    FROM user_team 
    WHERE user_id = $1
  `;

  const result = await db.query(teamQuery, [context.userId]);
  const userTeamIds = result.rows.map((r) => r.team_id);

  return PromptBuilder.buildSystemPrompt(context, userTeamIds);
}

  protected static async getTeamData(teamId: string) {
    const q = `
      SELECT name, start_date, end_date, last_updated_at, project_status, project_health, project_info
      FROM project_view
      WHERE in_organization(team_id, $1);
    `;
    const result = await db.query(q, [teamId]);
    return result.rows;
  }

  protected static async createTableSchema(): Promise<string> {
    // Use cache if valid
    const now = Date.now();
    if (this.schemaCache && now - this.schemaCache.timestamp < this.SCHEMA_CACHE_TTL) {
      return this.schemaCache.schema;
    }

    const tables = (process.env.TABLES || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    let schema = "";

    for (const table of tables) {
      const query = `
        WITH fk_info AS (
          SELECT DISTINCT
            fk_kcu.table_schema AS fk_schema,
            fk_kcu.table_name AS fk_table,
            fk_kcu.column_name AS fk_column,
            pk_kcu.table_schema AS pk_schema,
            pk_kcu.table_name AS pk_table,
            pk_kcu.column_name AS pk_column
          FROM information_schema.referential_constraints rco
          JOIN information_schema.table_constraints fk_tco 
            ON rco.constraint_name = fk_tco.constraint_name AND rco.constraint_schema = fk_tco.table_schema
          JOIN information_schema.table_constraints pk_tco
            ON rco.unique_constraint_name = pk_tco.constraint_name AND rco.unique_constraint_schema = pk_tco.table_schema
          JOIN information_schema.key_column_usage fk_kcu 
            ON fk_tco.constraint_name = fk_kcu.constraint_name AND fk_tco.table_schema = fk_kcu.table_schema
          JOIN information_schema.key_column_usage pk_kcu 
            ON pk_tco.constraint_name = pk_kcu.constraint_name AND pk_tco.table_schema = pk_kcu.table_schema
            AND fk_kcu.ordinal_position = pk_kcu.ordinal_position
        ),
        pk_info AS (
          SELECT 
            kcu.table_schema,
            kcu.table_name,
            kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        )
        SELECT 
          c.table_name || '(' || 
          STRING_AGG(
            c.column_name || '(' || c.data_type || ')' || 
            CASE 
              WHEN fk_info.pk_table IS NOT NULL 
              THEN ' REFERENCES ' || fk_info.pk_table || '(' || fk_info.pk_column || ')'
              ELSE ''
            END, 
            ', '
          ) || ')' AS table_schema_representation
        FROM information_schema.columns c
        LEFT JOIN fk_info 
          ON c.table_schema = fk_info.fk_schema AND c.table_name = fk_info.fk_table AND c.column_name = fk_info.fk_column
        LEFT JOIN pk_info 
          ON c.table_schema = pk_info.table_schema AND c.table_name = pk_info.table_name AND c.column_name = pk_info.column_name
        WHERE c.table_name = $1
        GROUP BY c.table_name;
      `;

      try {
        const result = await db.query(query, [table]);
        if (result.rows.length) {
          schema += result.rows.map((row) => row.table_schema_representation).join("\n") + "\n";
        }
      } catch (err) {
        console.error(`Schema error for table "${table}":`, err);
      }
    }

    // Update cache
    this.schemaCache = {
      timestamp: now,
      schema,
    };

    return schema;
  }

  protected static getTableSchema(): string {
    // This env variable may contain a simplified schema or override
    return process.env.SCHEMA || "";
  }

  protected static async getQueryData(
    schema: string,
    teamId: string,
    messages: ChatCompletionMessageParam[]
  ): Promise<string | { summary: string; data: any[] }> {
    // Step 1: Extract last user message
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find((msg) => msg.role === "user")?.content;

    if (!lastUserMessage || typeof lastUserMessage !== "string") {
      return { summary: "No valid user message found.", data: [] };
    }

    let fullSchema: string;
    try {
      fullSchema = await this.createTableSchema();
    } catch (err) {
      console.error("Schema generation failed:", err);
      throw new AppError("Failed to load schema. Please try again later.");
    }

    // Step 2: Get full schema, using cached version if possible
    const fullSchemaDescriptions = fullSchema
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!fullSchemaDescriptions.length) {
      throw new AppError("Schema could not be loaded. Please try again later.", 500);
    }

    // Step 3: Build query prompt with schema and context
    const queryPrompt = await PromptBuilder.buildQueryPrompt(
      schema,
      teamId,
      lastUserMessage,
      fullSchemaDescriptions
    );

    // Step 4: Insert prompt at beginning of message array to maintain context order
    messages.unshift(queryPrompt);

    // Optional: trim messages to max token count here if needed

    // Step 5: Call AI to generate query or summary
    let aiResponse;
    try {
      aiResponse = await OpenAIService.createChatCompletion(messages);
    } catch (err) {
      console.error("OpenAI chat completion error:", err);
      throw new AppError("AI service is currently unavailable.", 503);
    }

    // Clean AI response and parse JSON
    const cleaned = aiResponse?.content?.replace(/```(json)?|\\n|\\r/g, "").trim() || "{}";

    let result: any;
    try {
      result = JSON.parse(cleaned);
    } catch {
      console.error("Invalid AI JSON response:", cleaned);
      throw new AppError("Unable to process the request. Please try again.");
    }

    // Step 6: Validate result object
if (
  !result?.is_query ||
  typeof result.query !== "string" ||
  !new RegExp(`team_id\\s*=\\s*['"]?${teamId}['"]?`, "i").test(result.query)
) {
  return {
    summary: result?.summary || "Invalid or unsafe query generated.",
    data: [],
  };
}

// Validate SQL query syntax and safety here
try {
  validateSqlQuery(result.query, teamId);
} catch (validationError: any) {
  return {
    summary: `Query validation failed: ${validationError.message || validationError}`,
    data: [],
  };
}

// Step 7: Execute query safely with try/catch
try {
  const dbResult = await db.query(result.query);
  return {
    summary: result.summary,
    data: dbResult.rows,
  };
} catch (err) {
  console.error("Database query error:", err);
  return {
    summary: "We encountered an issue while trying to fetch data. Please try rephrasing your question.",
    data: [],
  };
}
  }

  protected static async createChatWithQueryData(
    dataList: { data: any[] },
    messages: ChatCompletionMessageParam[],
    teamId: string
  ) {
    // Build a prompt for the AI to create a human-readable response from query data
    messages.unshift(PromptBuilder.buildResponsePrompt({ items: dataList.data, teamId }));

    try {
      return await OpenAIService.createChatCompletion(messages);
    } catch (err) {
      console.error("Failed to generate chat completion with data:", err);
      throw new AppError("AI failed to respond to data. Please try again.", 500);
    }
  }

  protected static async getSQLQueryFromMessage({
  userMessage,
  userId,
  teamId,
  schema,
}: {
  userMessage: string;
  userId: string;
  teamId: string;
  schema: string;
}) {
  const prompt = await PromptBuilder.buildSQLQueryPrompt({ userMessage, userId, teamId, schema });

  const systemInstruction: ChatCompletionMessageParam = {
      role: "system",
      content: `You must only generate SQL queries that restrict results to team_id = '${teamId}'. Never expose data from other teams.`,
  };

  let res;
  try {
    res = await OpenAIService.createChatCompletion([systemInstruction, prompt]);
  } catch (err) {
    console.error("OpenAI service error:", err);
    throw new AppError("AI service is currently unavailable. Please try again later.", 503);
  }

  try {
  let content = res?.content;
  if (Buffer.isBuffer(content)) content = content.toString("utf-8");
  if (typeof content !== "string") content = String(content);

  let cleaned = content.replace(/```json|```/g, "").trim();

  cleaned = cleaned.replace(/\\\s*\n/g, " ");

  cleaned = cleaned.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");

  return JSON.parse(cleaned || "{}");
} catch (err) {
  console.error("Failed to parse SQL query from AI response:", err, res?.content);
  throw new AppError("Unable to understand the request. Please try rephrasing your message.", 400);
}
}

  protected static async getAnswerFromQueryResult({
  userMessage,
  result,
}: {
  userMessage: string;
  result: any[];
}) {
  const prompt = PromptBuilder.buildAnswerFromResultsPrompt({
    userMessage,
    queryResult: result,
  });

  // System instruction to improve tone and clarity
  const systemPrompt: ChatCompletionMessageParam = {
    role: "system",
    content:
    "You are a helpful assistant. Answer user questions naturally and clearly based on the data provided. Do not mention SQL queries, databases, or any internal processing. Just give a clear and direct answer.",
  };

  try {
    const res = await OpenAIService.createChatCompletion([systemPrompt, prompt]);

    let content = res?.content;
    if (Buffer.isBuffer(content)) content = content.toString("utf-8");
    if (typeof content !== "string") content = String(content);

    return {
      content: content.trim(),
    };
  } catch (err) {
    console.error("OpenAI answer generation error:", err);
    throw new AppError("Unable to generate a response. Please try again later.", 500);
  }
}
}