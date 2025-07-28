import React from 'react';
import { css, keyframes } from '@emotion/react';

// Animation
export const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`;

// Welcome Screen
export const welcomeContainerStyle = css`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
`;

// Fullscreen center layout for first screen
export const fullScreenCenterWrapper = css`
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

// Input style when centered before chat starts
export const fullScreenInputStyle = css`
  margin-top: 24px;
  width: 100%;
  max-width: 600px;
  padding: 0 16px;
`;

// Layout
export const containerStyle = css`
  display: flex;
  justify-content: center;
  align-items: stretch;
  height: 100vh;
  background-color: var(--background-color, #fff);
  color: var(--text-color, #000);
  overflow: hidden;
`;

// Scrollable chat wrapper
export const chatScrollableWrapper = css`
  flex: 1;
  width: 100%;
  overflow-y: auto;
  display: flex;
  justify-content: center;
  padding-bottom: 80px; /* space for sticky input */
`;

// Chat message container
export const chatInnerContainer = css`
  width: 100%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
`;

// Sticky input bar after chat starts
export const stickyInputContainerStyle = css`
  position: fixed;
  bottom: 0;
  width: 100%;
  background-color: var(--background-color, #fff);
  display: flex;
  justify-content: center;
  padding: 8px 12px;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
  z-index: 20;
`;

export const stickyInputInner = css`
  width: 100%;
  max-width: 600px;
`;

// Message Bubbles
export const bubbleUserStyle = css`
  background-color: transparent;
  color: var(--user-bubble-text, #000);
  padding: 0 16px;
  border-radius: 0;
  margin-bottom: 8px;
  max-width: 100%;
  align-self: flex-end;
  animation: ${fadeIn} 0.3s ease;
  box-shadow: none;
  word-break: break-word;
`;

export const bubbleAssistantStyle = css`
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  border-radius: 0 !important;
  margin-bottom: 8px;
  max-width: 100%;
  align-self: flex-start;
  animation: ${fadeIn} 0.3s ease;
  color: var(--assistant-bubble-text, #000);
  word-break: break-word;
`;

// Markdown Tables
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

// Suggestions
export const suggestionsBoxStyle = css`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 24px 0 12px 0;
`;

export const suggestionsTitleStyle = css`
  font-weight: bold;
  margin-bottom: 4px;
  width: 100%;
`;

export const suggestionItemStyle = css`
  background-color: var(--suggestion-bg, #898585ff);
  color: var(--suggestion-text, #333);
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  margin: 4px;

  &:hover {
    background-color: var(--suggestion-hover-bg, #807a7aff);
  }
`;

// Edit Area
export const editTextareaStyle = css`
  width: 100%;
  max-width: 1000px;
  border-radius: 8px;
  padding: 12px;
  font-size: 14px;
  resize: vertical;
  min-height: 60px;
  background-color: var(--background-color, #fff);
  color: var(--text-color, #000);
  border: 1px solid var(--border-color, #ccc);
`;

export const editButtonsContainer = css`
  margin-top: 8px;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
`;

// Chat Wrapper
export const chatWrapper = css`
  flex: 1;
  overflow-y: auto;
  display: block; /* no justify-content center */
  padding-bottom: 200px; /* space for sticky input */
`;

export const chatContentWrapper = css`
  width: 100%;
  max-width: 1100px;
  margin: 0 auto; /* center horizontally */
  display: flex;
  flex-direction: column;
`;

// Input area after chat starts
export const inputAreaStyle = css`
  width: 100%;
  max-width: 800px;
  padding: 12px;
`;

// Centered input before messages
export const centeredInputWrapper = css`
  flex: 1;
  width: 100%;
  max-width: 700px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
`;