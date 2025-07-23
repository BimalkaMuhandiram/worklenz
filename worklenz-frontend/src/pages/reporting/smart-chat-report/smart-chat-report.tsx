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
  const prevMessagesLengthRef = useRef(0);

  // Auto scroll on new messages
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [chatMessages.map(m => m.content).join('')]);

  // Copy text to clipboard
  const handleCopy = (text: string) => {
    copy(text);
    antdMessage.success('Copied to clipboard!');
  };

  // Editing handlers
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

    setChatMessages((prev) =>
      prev.map((msg, i) =>
        i === index ? { ...msg, content: editingContent, status: 'pending' } : msg
      )
    );
    cancelEdit();
    await handleSend(editingContent, true);
  };

  const deleteMessage = (id: string) => {
    setChatMessages((prev) => prev.filter((msg) => msg.timestamp !== id));
  };

  const onPromptsItemClick = (info: any) => {
    const text = info.data.description as string;
    setMessageInput(text);
    handleSend(text);
  };

  // Send message handler
  const handleSend = async (inputMessage: string, isRetry = false) => {
    if (!inputMessage.trim() || loading) return;

    const timestamp = new Date().toISOString();

    if (!isRetry) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'user', content: inputMessage, timestamp, status: 'pending' },
      ]);
    }

    const trimmedMessages = [...chatMessages, { role: 'user', content: inputMessage }]
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));

    setLoading(true);
    setMessageInput('');
    setIsTyping(true);

    try {
      const response = await reportingApiService.getChat({ chat: trimmedMessages });
      const answer = response?.body?.answer || 'Unable to generate a response.';
      const newSuggestions = response?.body?.suggestions || [];

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
      const assistantTimestamp = new Date().toISOString();

      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', timestamp: assistantTimestamp, status: 'typing' },
      ]);

      let index = 0;
      const typingInterval = setInterval(() => {
        index++;
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.timestamp === assistantTimestamp
              ? { ...msg, content: answer.slice(0, index) }
              : msg
          )
        );
        if (index >= answer.length) {
          clearInterval(typingInterval);
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.timestamp === assistantTimestamp ? { ...msg, status: 'sent' } : msg
            )
          );
          setIsTyping(false);
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

  // Retry sending a failed message
  const retrySend = (msg: IChatMessageWithStatus) => {
    setChatMessages((prev) =>
      prev.map((m) =>
        m.timestamp === msg.timestamp ? { ...m, status: 'pending' } : m
      )
    );
    handleSend(msg.content, true);
  };

  // Markdown renderer for assistant messages
  const md = Markdownit({ html: false, breaks: true });
  const renderAssistantMessage: BubbleProps['messageRender'] = (content) => (
    <Typography>
      <div
        css={markdownTableStyle}
        dangerouslySetInnerHTML={{ __html: md.render(content) }}
      />
    </Typography>
  );

  return (
    <Flex vertical css={containerStyle}>
      {chatMessages.length === 0 ? (
        <Flex
          vertical
          align="center"
          justify="center"
          style={{ height: '100%', width: '100%' }}
        >
          <Welcome
            variant="borderless"
            icon={<img src={welcomeScreenIcon} alt="Assistant" width={55} height={55} />}
            title="Hello, how can I help you?"
            description="I can generate summary reports and insights from your data."
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
                  <div key={msg.timestamp}>
                    {editingMessageId === msg.timestamp && msg.role === 'user' ? (
                      <>
                        <textarea
                          css={editTextareaStyle}
                          rows={3}
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                        />
                        <div css={editButtonsContainer}>
                          <Button type="primary" onClick={saveEdit}>Save</Button>
                          <Button onClick={cancelEdit}>Cancel</Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <Bubble
                          role={msg.role}
                          content={msg.content}
                          messageRender={msg.role === 'assistant' ? renderAssistantMessage : undefined}
                          css={msg.role === 'user' ? bubbleUserStyle : bubbleAssistantStyle}
                        />
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
                        {msg.role === 'assistant' && (
                          <Flex justify="flex-end" style={{ marginTop: 8 }}>
                            <CopyOutlined
                              style={{ cursor: 'pointer' }}
                              onClick={() => handleCopy(msg.content)}
                              title="Copy response"
                            />
                          </Flex>
                        )}
                        {msg.role === 'user' && (
                          <Flex gap="small" style={{ marginTop: 8 }}>
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
                            <Button
                              size="small"
                              icon={<DeleteOutlined />}
                              danger
                              onClick={() => deleteMessage(msg.timestamp)}
                              title="Delete message"
                            />
                          </Flex>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {isTyping && (
                  <Bubble role="assistant" typing={{ step: 1, interval: 40 }} content="..." />
                )}
                {suggestions.length > 0 && (
                  <div css={suggestionsBoxStyle}>
                    <Typography.Text css={suggestionsTitleStyle}>Suggestions:</Typography.Text>
                    <ul style={{ paddingLeft: 20, margin: 0 }}>
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
              </Flex>
            </div>
          </div>

          <Flex vertical align="center" css={stickyInputContainerStyle}>
            <div css={inputAreaStyle}>
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