import { Parser } from "node-sql-parser";

const parser = new Parser();

const ALLOWED_TABLES = [
  "task_updates", "team_member_info_view", "countries", "project_comment_mentions",
  "project_logs", "task_comment_attachments", "task_status_categories_backup",
  "task_labels_view", "tasks_with_status_view", "task_dependencies", "project_comments",
  "project_member_allocations", "timezones", "task_comment_reactions", "task_labels",
  "tasks_assignees", "organizations", "projects", "teams", "job_titles", "task_comments",
  "task_activity_logs", "task_phase", "task_attachments", "email_invitations", "task_work_log",
  "team_members", "tasks", "task_comment_contents", "task_templates_tasks", "project_access_levels",
  "task_timers", "task_statuses_backup", "project_phases", "users", "project_members",
  "team_labels", "task_priorities", "task_comment_mentions", "roles", "task_statuses",
  "project_categories"
];

// Main validator function: accepts single string or string[]
export function validateSqlQuery(sql: string, requiredTeamIds: string | string[]) {
  // Normalize to array
  const allowedTeamIds = Array.isArray(requiredTeamIds) ? requiredTeamIds : [requiredTeamIds];

  let ast;
  try {
    ast = parser.astify(sql, { database: "postgresql" });
  } catch (err) {
    throw new Error("SQL Parsing Error: Invalid SQL syntax.");
  }

  const statements = Array.isArray(ast) ? ast : [ast];

  for (const statement of statements) {
    if (statement.type !== "select") {
      throw new Error("Only SELECT queries are allowed.");
    }

    const tables = extractTables(statement);
    for (const tbl of tables) {
      if (!ALLOWED_TABLES.includes(tbl)) {
        throw new Error(`Access to table '${tbl}' is not allowed.`);
      }
    }

    if (!hasValidTeamIdFilter(statement.where, allowedTeamIds)) {
      throw new Error(`Query must filter results by team_id(s): ${allowedTeamIds.join(", ")}.`);
    }
  }
}

// Extract all table names from FROM clause and joins
function extractTables(statement: any): string[] {
  const tables: string[] = [];

  if (statement.from && Array.isArray(statement.from)) {
    for (const fromEntry of statement.from) {
      if (fromEntry.table) {
        tables.push(fromEntry.table);
      }

      // Check joins recursively
      if (fromEntry.join) {
        for (const joinEntry of fromEntry.join) {
          if (joinEntry.table) {
            tables.push(joinEntry.table);
          }
        }
      }
    }
  }

  return tables;
}

// Check if WHERE clause filters on any allowed team_id
function hasValidTeamIdFilter(where: any, allowedTeamIds: string[]): boolean {
  if (!where) return false;

  if (where.type === "binary_expr") {
    // Check for equality: team_id = 'some-id'
    if (
      where.left.type === "column_ref" &&
      where.left.column === "team_id" &&
      where.operator === "=" &&
      where.right.type === "string" &&
      allowedTeamIds.includes(where.right.value)
    ) {
      return true;
    }

    // Check IN clause: team_id IN (...)
    if (
      where.left.type === "column_ref" &&
      where.left.column === "team_id" &&
      where.operator.toLowerCase() === "in" &&
      where.right.type === "expr_list"
    ) {
      const values = where.right.value
        .filter((v: any) => v.type === "string")
        .map((v: any) => v.value);
      if (values.some((val: string) => allowedTeamIds.includes(val))) {
        return true;
      }
    }

    // Recursively check AND/OR expressions
    return hasValidTeamIdFilter(where.left, allowedTeamIds) || hasValidTeamIdFilter(where.right, allowedTeamIds);
  }

  return false;
}