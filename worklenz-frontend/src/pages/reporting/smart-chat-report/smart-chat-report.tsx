/** @jsxImportSource @emotion/react */
import { css } from '@emotion/react';
import React, { useEffect, useState, useRef } from 'react';
import { Typography, Flex, Button, message as antdMessage } from 'antd';
import {
  Bubble,
  BubbleProps,
  Sender,
  Welcome,
  Prompts,
} from '@ant-design/x';
import {
  LikeOutlined,
  DislikeOutlined,
  CopyOutlined,
  EditOutlined as EditIcon,
  DeleteOutlined as DeleteIcon,
  ReloadOutlined,
} from '@ant-design/icons';
import Markdownit from 'markdown-it';
import { useAppSelector } from '@/hooks/useAppSelector';
import { reportingApiService } from '@/api/reporting/reporting.api.service';
import logger from '@/utils/errorLogger';
import { IRPTTeam } from '@/types/reporting/reporting.types';
import { IChatMessage } from '@/types/aiChat/ai-chat.types';
import { firstScreenPrompts, senderPromptsItems } from './prompt';
import AssistantIcon from '../../../assets/icons/worklenz_ai_light.png';
import welcomeScreenIcon from '../../../assets/icons/worklenz_ai.png';
import copy from 'copy-to-clipboard';

import {
  containerStyle,
  bubbleUserStyle,
  bubbleAssistantStyle,
  markdownTableStyle,
  suggestionsBoxStyle,
  suggestionsTitleStyle,
  suggestionItemStyle,
  stickyInputContainerStyle,
} from './smart-chat-report-styles';

const md = Markdownit({ html: false, breaks: true });

const renderAssistantMessage: BubbleProps['messageRender'] = (content) => (
  <Typography>
    <div
      css={markdownTableStyle}
      dangerouslySetInnerHTML={{ __html: md.render(content) }}
    />
  </Typography>
);

const SmartChatReport = () => {
  const [messageInput, setMessageInput] = useState('');
  const [chatMessages, setChatMessages] = useState<IChatMessageWithStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [user, setUser] = useState<Record<string, any> | null>(null);
  const [teams, setTeams] = useState<IRPTTeam[]>([]);
  const [selectedTeam, setselectedTeam] = useState<Record<string, any> | null>(null);
  const [organization, setOrganization] = useState<Record<string, any> | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date().toDateString());
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const includeArchivedProjects = useAppSelector(
    (state) => state.reportingReducer.includeArchivedProjects
  );
  const showPrompts = chatMessages.length === 0;

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // New ref for chat container (scrollable div)
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when chatMessages or isTyping changes
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [chatMessages, isTyping]);

  useEffect(() => {
    setCurrentDate(new Date().toDateString());
  }, [includeArchivedProjects]);

  const handleCopy = (text: string) => {
    copy(text);
    antdMessage.success('Copied to clipboard!');
  };

  const startEdit = (msg: IChatMessage) => {
    setEditingMessageId(msg.timestamp);
    setEditingContent(msg.content);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const saveEdit = async () => {
    if (!editingContent.trim()) {
      antdMessage.error('Message cannot be empty.');
      return;
    }

    const editedIndex = chatMessages.findIndex(
      (msg) => msg.timestamp === editingMessageId
    );

    if (editedIndex === -1) {
      antdMessage.error('Message not found.');
      cancelEdit();
      return;
    }

    setChatMessages((prev) =>
      prev.map((msg, index) =>
        index === editedIndex
          ? { ...msg, content: editingContent, status: 'pending' }
          : msg
      )
    );

    cancelEdit();
    await handleSend(editingContent, true);
  };

  const deleteMessage = (id: string) => {
    setChatMessages((prev) => prev.filter((msg) => msg.timestamp !== id));
  };

  const onPromptsItemClick = (info: any) => {
    setMessageInput(info.data.description as string);
    handleSend(info.data.description as string);
  };

  const handleSend = async (inputMessage: string, isRetry = false) => {
    if (!inputMessage.trim() || loading) return;

    const timestamp = new Date().toISOString();

    if (!isRetry) {
      const userMessage: IChatMessageWithStatus = {
        role: 'user',
        content: inputMessage,
        timestamp,
        status: 'pending',
      };
      setChatMessages((prev) => [...prev, userMessage]);
    }

    const trimmedMessages = [...chatMessages, { role: 'user', content: inputMessage }]
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));

    setLoading(true);
    setMessageInput('');
    setIsTyping(true);

    try {
      const requestBody = { chat: trimmedMessages };
      const response = await reportingApiService.getChat(requestBody);

      let responseText = 'Hmm… I couldn’t generate a good answer right now. You can try rephrasing or retrying.';
      let newSuggestions: string[] = [];

      if (response?.body) {
        responseText = response.body.answer || responseText;
        newSuggestions = response.body.suggestions || [];
      }

      if (!isRetry) {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.content === inputMessage && msg.status === 'pending'
              ? { ...msg, status: 'sent' }
              : msg
          )
        );
      }

      setSuggestions(newSuggestions);

      const timestampAssistant = new Date().toISOString();

      // Add empty assistant message to begin typing
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '',
          timestamp: timestampAssistant,
          status: 'typing',
        },
      ]);

      let index = 0;

      const typingInterval = setInterval(() => {
        index++;

        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.timestamp === timestampAssistant
              ? {
                  ...msg,
                  content: responseText.slice(0, index),
                }
              : msg
          )
        );

        if (index >= responseText.length) {
          clearInterval(typingInterval);
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.timestamp === timestampAssistant
                ? { ...msg, status: 'sent' }
                : msg
            )
          );
          setIsTyping(false);
        }
      }, 10); // Typing speed (ms per character)
    } catch (error) {
      logger.error('handleSend', error);
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.content === inputMessage && msg.role === 'user'
            ? { ...msg, status: 'failed' }
            : msg
        )
      );
      setIsTyping(false);
    } finally {
      setLoading(false);
    }
  };

  const onSuggestionClick = (suggestion: string) => {
    setMessageInput(suggestion);
    handleSend(suggestion);
  };

  const retrySend = async (msg: IChatMessageWithStatus) => {
    setChatMessages((prev) =>
      prev.map((m) =>
        m.timestamp === msg.timestamp
          ? { ...m, status: 'pending' }
          : m
      )
    );

    await handleSend(msg.content, true);
  };

  return (
    <Flex
      vertical
      className="ant-col ant-col-xxl-10 ant-col-xxl-offset-6"
      css={containerStyle}
      style={{ height: '100%' }}
    >
      <Flex
        gap="middle"
        vertical
        ref={chatContainerRef}  
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: 8,
          paddingBottom: 16, 
          maxHeight: 'calc(100vh - 200px)',
        }}
      >
        {chatMessages.length > 0 ? (
          chatMessages.map((msg) => (
            <div key={msg.timestamp} style={{ marginBottom: '1.5rem' }}>
              {editingMessageId === msg.timestamp && msg.role === 'user' ? (
                <>
                  <textarea
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      padding: 8,
                      fontSize: 14,
                      backgroundColor: 'var(--background-color)',
                      color: 'var(--text-color)',
                      border: '1px solid var(--border-color)',
                      resize: 'vertical',
                      minHeight: 60,
                    }}
                    rows={3}
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                  />
                  <div
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      gap: 12,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Button type="primary" onClick={saveEdit}>
                      Save
                    </Button>
                    <Button onClick={cancelEdit}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  <Bubble
                    role={msg.role}
                    content={msg.content}
                    messageRender={msg.role === 'assistant' ? renderAssistantMessage : undefined}
                    css={
                      msg.role === 'user'
                        ? bubbleUserStyle
                        : bubbleAssistantStyle
                    }
                    style={{ borderRadius: 16, marginRight: '1rem', maxWidth: '85%', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' }}
                  />

                  {msg.status === 'failed' && msg.role === 'user' && (
                    <Button
                      size="small"
                      danger
                      icon={<ReloadOutlined />}
                      onClick={() => retrySend(msg)}
                      style={{ marginTop: 4 }}
                    >
                      Retry
                    </Button>
                  )}

                  {msg.role === 'assistant' && (
                    <Flex
                      justify="flex-end"
                      style={{
                        marginTop: 8,
                        marginLeft: 12,
                        marginRight: 12,
                        fontSize: 16,
                        cursor: 'pointer',
                      }}
                    >
                      <CopyOutlined
                        title="Copy"
                        onClick={() => handleCopy(msg.content)}
                      />
                    </Flex>
                  )}

                  {msg.role === 'user' && (
                    <Flex gap="small" style={{ marginTop: 8 }}>
                      <Button
                        size="small"
                        icon={<EditIcon />}
                        onClick={() => startEdit(msg)}
                      />
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => handleCopy(msg.content)}
                      />
                      <Button
                        size="small"
                        icon={<DeleteIcon />}
                        danger
                        onClick={() => deleteMessage(msg.timestamp)}
                      />
                    </Flex>
                  )}
                </>
              )}
            </div>
          ))
        ) : (
          <Bubble variant="borderless" />
        )}

        {isTyping && (
          <Bubble role="assistant" typing={{ step: 1, interval: 40 }} content="..." />
        )}

        {suggestions.length > 0 && (
          <div css={suggestionsBoxStyle}>
            <Typography.Text css={suggestionsTitleStyle}>
              Suggestions:
            </Typography.Text>
            <ul style={{ paddingLeft: '20px', margin: 0 }}>
              {suggestions.map((suggestion, index) => (
                <li
                  key={index}
                  css={suggestionItemStyle}
                  onClick={() => onSuggestionClick(suggestion)}
                >
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}

        {showPrompts && (
          <>
            <Welcome
              variant="borderless"
              icon={
                <img
                  src={welcomeScreenIcon}
                  alt="Assistant"
                  style={{ width: 55, height: 55 }}
                />
              }
              title="Hello, how can I help you?"
              description="Based on your organization data, I can generate summary reports and insights."
            />
            <Flex justify="center" align="center">
              <Prompts
                items={firstScreenPrompts}
                onItemClick={onPromptsItemClick}
                styles={{
                  item: {
                    backgroundColor: 'var(--prompt-bg)',
                    color: 'var(--prompt-text)',
                    border: '1px solid var(--prompt-border)',
                  },
                }}
              />
            </Flex>
          </>
        )}
        <div ref={chatEndRef} />
      </Flex>

      <Flex
        justify="center"
        align="flex-end"
        css={stickyInputContainerStyle}
        vertical
      >
        {chatMessages.length < 3 && (
          <Prompts
            styles={{ item: { borderRadius: 50 } }}
            items={senderPromptsItems}
            onItemClick={onPromptsItemClick}
          />
        )}
        <Sender
          loading={loading}
          placeholder="Type your message here...."
          value={messageInput}
          onChange={setMessageInput}
          onSubmit={() => {
            if (chatMessages.length > 100) {
              alert('Message rate limit exceeded');
              return;
            }
            handleSend(messageInput);
          }}
        />
      </Flex>
    </Flex>
  );
};

export default SmartChatReport;

interface IChatMessageWithStatus extends IChatMessage {
  status?: 'pending' | 'failed' | 'sent' | 'typing';
}
