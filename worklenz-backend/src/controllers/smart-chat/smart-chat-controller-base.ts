import db from "../../config/db";
import ReportingControllerBase from "../reporting/reporting-controller-base";
import { OpenAIService } from "./openai-service";
import { PromptBuilder } from "./prompt-builder";

export default class SmartChatControllerBase extends ReportingControllerBase {
  protected static getOpenAiClient() {
    return OpenAIService.getClient();
  }

  protected static getSystemPrompt(data: any) {
    return PromptBuilder.buildSystemPrompt(data);
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

  protected static async createTableSchema() {
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
        WHERE c.table_name = '${table}'
        GROUP BY c.table_name;
      `;

      try {
        const result = await db.query(query);
        if (result.rows.length) {
          schema += result.rows.map((row) => row.table_schema_representation).join("\n") + "\n";
        }
      } catch (err) {
        console.error(`Schema error (${table}):`, err);
      }
    }

    return schema;
  }

  protected static getTableSchema() {
    return process.env.SCHEMA || "";
  }

  protected static async getQueryData(schema: string, teamId: string, messages: any[]) {
    messages.unshift(PromptBuilder.buildQueryPrompt(schema, teamId));
    const aiResponse = await OpenAIService.createChatCompletion(messages);

    const cleaned = aiResponse?.content?.replace(/```json|```/g, "").trim() || "{}";

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      return {
        summary: "Failed to parse AI response.",
        data: [],
      };
    }

    if (!result?.is_query || !result?.query?.includes(teamId)) {
      return {
        summary: result.summary || "Invalid query.",
        data: [],
      };
    }

    try {
      const dbResult = await db.query(result.query);
      return JSON.stringify({
        summary: result.summary,
        data: dbResult.rows,
      });
    } catch (err) {
      console.error("Database query error:", err);
      return {
        summary: "Database query failed.",
        data: [],
      };
    }
  }

  protected static async createChatWithQueryData(dataList: any, messages: any[], teamId: string) {
  messages.unshift(PromptBuilder.buildResponsePrompt({ items: dataList.data, teamId }));
  return OpenAIService.createChatCompletion(messages);
}

  // 🆕 Generate SQL query from user message
  protected static async getSQLQueryFromMessage({
    userMessage,
    userId,
    teamId,
    schema,
  }: {
    userMessage: string;
    userId: string;
    teamId: string;
    schema: any;
  }) {
    const prompt = PromptBuilder.buildSQLQueryPrompt({
      userMessage,
      userId,
      teamId,
      schema,
    });

    const res = await OpenAIService.createChatCompletion([prompt]);

    try {
      const content = res?.content?.replace(/```json|```/g, "").trim() || "{}";
      return JSON.parse(content);
    } catch (err) {
      console.error("Failed to parse SQL query from AI response:", err);
      return null;
    }
  }

  // 🆕 Convert SQL result to human-friendly message
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

    return OpenAIService.createChatCompletion([prompt]);
  }
}
