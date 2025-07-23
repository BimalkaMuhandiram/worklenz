import React from 'react';
import {
  FireOutlined,
  RocketOutlined,
  CommentOutlined,
  HeartOutlined,
  ReadOutlined,
  SmileOutlined,
} from '@ant-design/icons'; // UI icons
import { Prompts, PromptsProps } from '@ant-design/x'; // Prompts component
import { Space } from 'antd'; // For layout

// Helper to display label with icon
const renderTitle = (icon: React.ReactElement, title: string) => (
  <Space align="start">
    {icon}
    <span>{title}</span>
  </Space>
);

export const senderPromptsItems: PromptsProps['items'] = [];

// Categorized prompt group with the two requested prompts
export const firstScreenPrompts: PromptsProps['items'] = [
  {
    key: 'project-status',
    children: [
      {
        key: 'urgent-deadlines',
        description: 'Show me urgent project deadlines',
        icon: <RocketOutlined style={{ color: '#52c41a' }} />,
      },
      {
        key: 'in-progress',
        description: 'How many projects are currently in progress',
        icon: <FireOutlined style={{ color: '#FF4D4F' }} />,
      },
    ],
  },
];