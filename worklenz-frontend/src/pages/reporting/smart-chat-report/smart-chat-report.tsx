/** @jsxImportSource @emotion/react */
import { css } from '@emotion/react';
import React, { useEffect, useState, useRef } from 'react';
import { Typography, Flex, Button } from 'antd';
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
import { message as antdMessage } from 'antd';
import copy from 'copy-to-clipboard';
import { markdownTableStyle } from './smart-chat-report-styles';
import {
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const md = Markdownit({ html: false, breaks: true });

const renderAssistantMessage: BubbleProps['messageRender'] = (content) => {
  try {
    const parsed = JSON.parse(content);

    if (parsed.type === 'chart' && Array.isArray(parsed.data)) {
      const { chartType, data, title } = parsed;

      const chartColors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50'];

      const keys = Object.keys(data[0]).filter((key) => key !== 'name');

      return (
        <div style={{ width: '100%', height: 300 }}>
          <Typography.Title level={5}>{title}</Typography.Title>
          <ResponsiveContainer width="100%" height="100%">
            {
              (() => {
                switch (chartType) {
                  case 'bar':
                    return (
                      <BarChart data={data}>
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        {keys.map((key, index) => (
                          <Bar key={key} dataKey={key} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </BarChart>
                    );
                  case 'line':
                    return (
                      <LineChart data={data}>
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        {keys.map((key, index) => (
                          <Line key={key} type="monotone" dataKey={key} stroke={chartColors[index % chartColors.length]} />
                        ))}
                      </LineChart>
                    );
                  case 'pie':
                    return (
                      <PieChart width={400} height={300}>
                        <Tooltip />
                        <Legend />
                        <Pie
                          data={data}
                          dataKey={keys[0]}
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label
                        >
                          {data.map((entry: Record<string, any>, index: number) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={chartColors[index % chartColors.length]}
                            />
                          ))}

                        </Pie>
                      </PieChart>
                    );

                  default:
                    return <div>Unsupported chart type: {chartType}</div>;
                }
              })()
            }
          </ResponsiveContainer>
        </div>
      );
    }
  } catch (err) {
    // Not a chart, fall back to Markdown
  }

  return (
    <Typography>
      <div
        css={markdownTableStyle}
        dangerouslySetInnerHTML={{ __html: md.render(content) }}
      />
    </Typography>
  );
};

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

  const includeArchivedProjects = useAppSelector(
    (state) => state.reportingReducer.includeArchivedProjects
  );
  const showPrompts = chatMessages.length === 0;

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  useEffect(() => {
    setCurrentDate(new Date().toDateString());
  }, [includeArchivedProjects]);

  const handleCopy = (text: string) => {
    copy(text);
    antdMessage.success('Copied to clipboard!');
  };

  const handleLike = (msg: IChatMessage) => {
    console.log('👍 Liked message:', msg.content);
  };

  const handleDislike = (msg: IChatMessage) => {
    console.log('👎 Disliked message:', msg.content);
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
    await handleSend(editingContent, true); // Use retry flag to avoid adding new message
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

    try {
      const requestBody = { chat: trimmedMessages };
      const response = await reportingApiService.getChat(requestBody);

      const responseText =
        typeof response?.body === 'string'
          ? (response.body as string).trim()
          : 'Sorry, no response from assistant.';

      if (!isRetry) {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.content === inputMessage && msg.status === 'pending'
              ? { ...msg, status: 'sent' }
              : msg
          )
        );
      }

      setIsTyping(true);

      const aiMessage: IChatMessageWithStatus = {
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        status: 'sent',
      };

      setTimeout(() => {
        setChatMessages((prev) => [...prev, aiMessage]);
        setIsTyping(false);
      }, 500);
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

  const retrySend = async (msg: IChatMessageWithStatus) => {
    setChatMessages((prev) => prev.filter((m) => m.timestamp !== msg.timestamp));
    await handleSend(msg.content, true);
  };

  const containerStyle = css`
    background-color: var(--background-color);
    color: var(--text-color);
    height: 100vh;
    padding: 1rem;
    display: flex;
    flex-direction: column;
  `;

  const bubbleUserStyle = css`
    background-color: var(--user-bubble-bg);
    color: var(--user-bubble-text);
  `;

  const bubbleAssistantStyle = css`
    background-color: var(--assistant-bubble-bg);
    color: var(--assistant-bubble-text);
  `;

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
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: 8,
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
                      gap: 8,
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
                    style={{ borderRadius: 16, marginRight: '1rem', maxWidth: '90%' }}
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
                      justify="space-between"
                      style={{
                        marginTop: 8,
                        marginLeft: 12,
                        marginRight: 12,
                        fontSize: 16,
                      }}
                    >
                      <Flex gap="middle" style={{ cursor: 'pointer' }}>
                        <LikeOutlined title="Like" onClick={() => handleLike(msg)} />
                        <DislikeOutlined
                          title="Dislike"
                          onClick={() => handleDislike(msg)}
                        />
                      </Flex>
                      <CopyOutlined
                        title="Copy"
                        style={{ cursor: 'pointer' }}
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

      <Flex justify="center" align="flex-end" style={{ fontSize: '5em' }} vertical>
        {chatMessages.length < 3 && (
          <Prompts
            styles={{ item: { borderRadius: 50 } }}
            items={senderPromptsItems}
            onItemClick={onPromptsItemClick}
          />
        )}
      </Flex>

      <Flex justify="center" align="flex-end" style={{ paddingTop: '1rem' }} vertical>
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
  status?: 'pending' | 'failed' | 'sent';
}