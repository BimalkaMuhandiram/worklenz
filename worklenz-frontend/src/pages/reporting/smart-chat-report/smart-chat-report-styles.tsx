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
  min-height: 60px;
  background-color: var(--background-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
`;

// Edit buttons
export const editButtonsContainer = css`
  margin-top: 8px;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
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
  border-radius: 16px;
  margin-bottom: 8px;
  max-width: 80%;
`;

// Assistant bubble
export const bubbleAssistantStyle = css`
  background-color: var(--assistant-bubble-bg);
  color: var(--assistant-bubble-text);
  padding: 12px;
  border-radius: 16px;
  margin-bottom: 8px;
  max-width: 80%;
`;

export const suggestionsBoxStyle = css`
  background-color: var(--suggestion-bg);
  color: var(--suggestion-text);
  padding: 16px;
  border-radius: 12px;
  margin-top: 12px;
  max-width: 80%;
  align-self: flex-start;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
`;

export const suggestionsTitleStyle = css`
  font-weight: bold;
  margin-bottom: 8px;
  color: var(--suggestion-text);
`;

export const suggestionItemStyle = css`
  cursor: pointer;
  color: var(--suggestion-link);
  margin-bottom: 6px;
  transition: color 0.2s;

  &:hover {
    color: var(--suggestion-link-hover);
  }
`;

// Sticky input container (for bottom input area)
export const stickyInputContainerStyle = css`
  position: sticky;
  bottom: 0;
  background-color: var(--background-color);
  padding-top: 12px;
  padding-bottom: 12px;
  z-index: 10;
  border-top: 1px solid var(--border-color);
`;
