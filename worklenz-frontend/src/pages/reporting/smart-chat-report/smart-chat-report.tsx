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
  CopyOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import Markdownit from 'markdown-it';
import { useAppSelector } from '@/hooks/useAppSelector';
import { reportingApiService } from '@/api/reporting/reporting.api.service';
import logger from '@/utils/errorLogger';
import { IChatMessage } from '@/types/aiChat/ai-chat.types';
import { firstScreenPrompts, senderPromptsItems } from './prompt';
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
  editTextareaStyle,
  editTextareaWrapper, 
  editButtonsContainer,
  chatWrapper,
  chatContentWrapper,
  inputAreaStyle,
  centeredInputWrapper,
} from './smart-chat-report-styles';

interface IChatMessageWithStatus extends IChatMessage {
  status?: 'pending' | 'failed' | 'sent' | 'typing';
}

const SmartChatReport: React.FC = () => {
  const [messageInput, setMessageInput] = useState('');
  const [chatMessages, setChatMessages] = useState<IChatMessageWithStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const includeArchivedProjects = useAppSelector(
    (state) => state.reportingReducer.includeArchivedProjects
  );

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };
  const prevMessagesLengthRef = useRef(0);

  useEffect(() => {
  const container = chatContainerRef.current;
  if (!container) return;

  const scrollTimeout = setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);

  return () => clearTimeout(scrollTimeout);
}, [chatMessages.map(m => m.content).join('')]); 

  useEffect(() => {
  return () => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
    }
  };
  }, []);

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

  const index = chatMessages.findIndex((msg) => msg.timestamp === editingMessageId);
  if (index === -1) {
    antdMessage.error('Message not found.');
    return;
  }

  const originalMessage = chatMessages[index];
  const updatedMessage: IChatMessageWithStatus = {
    ...originalMessage,
    content: editingContent,
    status: 'pending',
  };

  const assistantTimestamp = new Date().toISOString();

  const newMessages = [...chatMessages];
  newMessages[index] = updatedMessage;

  if (
    newMessages[index + 1] &&
    newMessages[index + 1].role === 'assistant'
  ) {
    newMessages.splice(index + 1, 1);
  }

  const contextMessages = newMessages
    .slice(0, index + 1)
    .map(({ role, content }) => ({ role, content }));

  setChatMessages([
    ...newMessages.slice(0, index + 1),
    {
      role: 'assistant',
      content: '',
      timestamp: assistantTimestamp,
      status: 'typing',
    },
    ...newMessages.slice(index + 1),
  ]);

  cancelEdit();

  try {
    const response = await reportingApiService.getChat({ chat: contextMessages });
    const answer = response?.body?.answer || 'Unable to generate a response.';
    const newSuggestions = response?.body?.suggestions || [];
    setSuggestions(newSuggestions);

    typingIndexRef.current = 0;
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);

    typingIntervalRef.current = setInterval(() => {
      typingIndexRef.current++;

      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.timestamp === assistantTimestamp
            ? { ...msg, content: answer.slice(0, typingIndexRef.current) }
            : msg
        )
      );

      if (typingIndexRef.current >= answer.length) {
        clearInterval(typingIntervalRef.current!);
        typingIntervalRef.current = null;
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.timestamp === assistantTimestamp
              ? { ...msg, status: 'sent' }
              : msg
          )
        );
      }
    }, 10);
  } catch (err) {
    logger.error('saveEdit error', err);
    antdMessage.error('Failed to update message.');
    setChatMessages((prev) =>
      prev.map((msg) =>
        msg.timestamp === editingMessageId
          ? { ...msg, status: 'failed' }
          : msg
      )
    );
  }
};

  const onPromptsItemClick = (info: any) => {
    const text = info.data.description as string;
    setMessageInput(text);
    handleSend(text);
  };

  const typingIndexRef = useRef(0);

const handleSend = async (inputMessage: string, isRetry = false) => {
  if (!inputMessage.trim() || loading) return;

  setLoading(true);
  setMessageInput('');
  setIsTyping(true);

  try {
    // Step 1: Add user message
    let updatedMessages: IChatMessageWithStatus[] = [];
    setChatMessages((prev) => {
      updatedMessages = [
        ...prev,
        {
          role: 'user',
          content: inputMessage,
          timestamp: new Date().toISOString(),
          status: 'pending',
        },
      ];
      return updatedMessages;
    });

    await new Promise((r) => setTimeout(r, 0)); // let state update

    // Step 2: Prepare request
    const trimmedMessages = updatedMessages
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));

    // Step 3: Call API
    const response = await reportingApiService.getChat({ chat: trimmedMessages });
    const answer = response?.body?.answer || 'Unable to generate a response.';
    const newSuggestions = response?.body?.suggestions || [];

    // Step 4: Mark user message as sent
    setChatMessages((prev) =>
      prev.map((msg) =>
        msg.content === inputMessage &&
        msg.status === 'pending' &&
        msg.role === 'user'
          ? { ...msg, status: 'sent' }
          : msg
      )
    );

    setSuggestions(newSuggestions);

    // Step 5: Add assistant "typing" message
    const assistantTimestamp = new Date().toISOString();
    setChatMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        timestamp: assistantTimestamp,
        status: 'typing',
      },
    ]);

    scrollToBottom();

    // Step 6: Typing animation with ref for index
    typingIndexRef.current = 0;
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);

    typingIntervalRef.current = setInterval(() => {
      typingIndexRef.current++;

      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.timestamp === assistantTimestamp
            ? {
                ...msg,
                content: answer.slice(0, typingIndexRef.current),
              }
            : msg
        )
      );

      scrollToBottom();

      if (typingIndexRef.current >= answer.length) {
        if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null; 

        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.timestamp === assistantTimestamp
              ? { ...msg, status: 'sent' }
              : msg
          )
        );

        setIsTyping(false);
        scrollToBottom();
      }
    }, 10);
  } catch (err) {
    logger.error('handleSend', err);
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

  const retrySend = (msg: IChatMessageWithStatus) => {
    setChatMessages((prev) =>
      prev.map((m) =>
        m.timestamp === msg.timestamp ? { ...m, status: 'pending' } : m
      )
    );
    handleSend(msg.content, true);
  };

  const md = Markdownit({ html: false, breaks: true });
  const renderAssistantMessage: BubbleProps['messageRender'] = (content) => (
    <Typography>
      <div
        css={markdownTableStyle}
        dangerouslySetInnerHTML={{ __html: md.render(content) }}
      />
    </Typography>
  );

  const messageWrapperStyle = (role: string) => css`
    display: flex;
    justify-content: ${role === 'user' ? 'flex-end' : 'flex-start'};
    margin-bottom: 12px;
  `;

  return (
    <Flex vertical css={containerStyle}>
      {chatMessages.length === 0 ? (
        <Flex
          vertical
          align="center"
          justify="center"
          style={{ height: '70%', width: '100%' }}
        >
          <Welcome
            variant="borderless"
            icon={<img src={welcomeScreenIcon} alt="Assistant" width={55} height={55} />}
            title="Hello, how can I help you?"
            description="I can generate summary reports and insights from your data. "
          />
          <Prompts items={firstScreenPrompts} onItemClick={onPromptsItemClick} />
          <div css={centeredInputWrapper}>
            <Sender
              loading={loading}
              placeholder="Type your message here..."
              value={messageInput}
              onChange={setMessageInput}
              onSubmit={() => handleSend(messageInput)}
            />
          </div>
        </Flex>
      ) : (
        <>
        <div css={chatWrapper} ref={chatContainerRef}>
          <div css={chatContentWrapper}>
            <Flex vertical gap="middle">
              {chatMessages.map((msg) => (
                <div key={msg.timestamp} css={messageWrapperStyle(msg.role)}>
                  <div>
                    {editingMessageId === msg.timestamp && msg.role === 'user' ? (
                      <div css={editTextareaWrapper}>
                        <textarea
                          css={editTextareaStyle}
                          rows={3}
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                        />
                        <div css={editButtonsContainer}>
                          <Button type="primary" onClick={saveEdit}>
                            Save
                          </Button>
                          <Button onClick={cancelEdit}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Bubble
                          role={msg.role}
                          content={msg.content}
                          messageRender={msg.role === 'assistant' ? renderAssistantMessage : undefined}
                          css={msg.role === 'user' ? bubbleUserStyle : bubbleAssistantStyle}
                          variant={msg.role === 'assistant' ? 'borderless' : undefined}
                        />
                        {msg.role === 'assistant' && msg.status === 'sent' && (
                          <Flex justify="flex-start" style={{ marginTop: 6 }}>
                            <CopyOutlined
                              style={{ cursor: 'pointer' }}
                              onClick={() => handleCopy(msg.content)}
                              title="Copy response"
                            />
                          </Flex>
                        )}

                        {msg.role === 'user' && editingMessageId !== msg.timestamp && (
                          <Flex justify="flex-end" gap="small" style={{ marginTop: 6 }}>
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => startEdit(msg)}
                              title="Edit message"
                            />
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => handleCopy(msg.content)}
                              title="Copy message"
                            />
                          </Flex>
                        )}
                      </>
                    )}
                  </div>
                  {msg.status === 'failed' && msg.role === 'user' && (
                    <Button
                        danger
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => retrySend(msg)}
                        style={{ marginTop: 4 }}
                      >
                        Retry
                    </Button>
                  )}
                </div>
                ))}
                {isTyping && (
                  <Bubble role="assistant" typing={{ step: 1, interval: 40 }} content="..." />
                )}
              </Flex>
            </div>
          </div>

          <Flex vertical align="center" css={stickyInputContainerStyle}>
            <div css={inputAreaStyle}>
              {suggestions.length > 0 && (
                <div css={suggestionsBoxStyle}>
                  <Typography.Text css={suggestionsTitleStyle}></Typography.Text>
                  <ul style={{ paddingLeft: 170, margin: 5 }}> 
                    {suggestions.map((s, i) => (
                      <li
                        key={i}
                        css={suggestionItemStyle}
                        onClick={() => handleSend(s)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if(e.key === 'Enter') handleSend(s); }}
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {chatMessages.length < 3 && (
                <Prompts
                  styles={{ item: { borderRadius: 50 } }}
                  items={senderPromptsItems}
                  onItemClick={onPromptsItemClick}
                />
              )}
              <Sender
                loading={loading}
                placeholder="Type your message here..."
                value={messageInput}
                onChange={setMessageInput}
                onSubmit={() => handleSend(messageInput)}
              />
            </div>
          </Flex>
        </>
      )}
    </Flex>
  );
};

export default SmartChatReport;