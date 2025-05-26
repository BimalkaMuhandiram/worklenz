import React from "react";
import { css } from '@emotion/react';

// Avatars
export const fooAvatar: React.CSSProperties = {
  color: '#f56a00',
  backgroundColor: '#fde3cf',
};

export const barAvatar: React.CSSProperties = {
  color: '#fff',
  backgroundColor: '#87d068',
};

// Message action buttons
export const messageActionsStyle = css`
  display: flex;
  gap: 8px;
  margin-top: 4px;
`;

// Edit textarea
export const editTextareaStyle = css`
  width: 100%;
  border-radius: 8px;
  padding: 8px;
  font-size: 14px;
  resize: vertical;
`;

// Edit buttons
export const editButtonsContainer = css`
  margin-top: 4px;
  display: flex;
  gap: 8px;
`;

// Markdown table
export const markdownTableStyle = css`
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    border: 1px solid #e0e0e0;
  }

  th, td {
    border: 1px solid #e0e0e0;
    padding: 8px;
    text-align: left;
  }

  th {
    background-color: #f5f5f5;
    font-weight: bold;
  }
`;

// Chart container
export const chartContainer = css`
  padding: 1rem;
  background-color: var(--chart-background);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  margin-top: 1rem;
`;

// Chat container: main background and text color
export const containerStyle = css`
  background-color: var(--background-color);
  color: var(--text-color);
  height: 100vh;
  padding: 1rem;
  overflow-y: auto;
`;

// User bubble
export const bubbleUserStyle = css`
  background-color: var(--user-bubble-bg);
  color: var(--user-bubble-text);
  padding: 12px;
  border-radius: 12px;
  margin-bottom: 8px;
  max-width: 80%;
`;

// Assistant bubble
export const bubbleAssistantStyle = css`
  background-color: var(--assistant-bubble-bg);
  color: var(--assistant-bubble-text);
  padding: 12px;
  border-radius: 12px;
  margin-bottom: 8px;
  max-width: 80%;
`;