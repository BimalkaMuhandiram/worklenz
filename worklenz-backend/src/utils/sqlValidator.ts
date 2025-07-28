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

export function validateSqlQuery(sql: string, requiredTeamId: string) {
  let ast;
  try {
    ast = parser.astify(sql, { database: "postgresql" });
  } catch (err) {
    throw new Error("SQL Parsing Error: Invalid SQL syntax.");
  }

  // Support array for multiple statements, if any
  const statements = Array.isArray(ast) ? ast : [ast];

  for (const statement of statements) {
    // 1. Only allow SELECT queries
    if (statement.type !== "select") {
      throw new Error("Only SELECT queries are allowed.");
    }

    // 2. Validate table names
    const tables = extractTables(statement);
    for (const tbl of tables) {
      if (!ALLOWED_TABLES.includes(tbl)) {
        throw new Error(`Access to table '${tbl}' is not allowed.`);
      }
    }

    // 3. Validate presence of team_id filter in WHERE clause
    if (!hasValidTeamIdFilter(statement.where, requiredTeamId)) {
      throw new Error(`Query must filter results by team_id = '${requiredTeamId}'.`);
    }
  }
}

// Helper to extract table names from AST statement
function extractTables(statement: any): string[] {
  const tables: string[] = [];

  if (statement.from && Array.isArray(statement.from)) {
    for (const fromEntry of statement.from) {
      if (fromEntry.table) tables.push(fromEntry.table);
      // handle joins, subqueries if needed
    }
  }

  return tables;
}

// Helper to check team_id filter in WHERE clause
function hasValidTeamIdFilter(where: any, requiredTeamId: string): boolean {
  if (!where) return false;

  // Recursively check WHERE AST for team_id = 'requiredTeamId'
  if (where.type === "binary_expr") {
    if (
      (where.left.type === "column_ref" && where.left.column === "team_id") &&
      (where.operator === "=") &&
      ((where.right.type === "string" && where.right.value === requiredTeamId) ||
        (where.right.type === "number" && String(where.right.value) === requiredTeamId))
    ) {
      return true;
    }
    // Check left and right recursively for AND/OR expressions
    return (
      hasValidTeamIdFilter(where.left, requiredTeamId) ||
      hasValidTeamIdFilter(where.right, requiredTeamId)
    );
  }
  return false;
}