import { CommentOutlined, FireOutlined, HeartOutlined, ReadOutlined, RocketOutlined, SmileOutlined } from "@ant-design/icons"; // Brings in icons for UI categories
import { Prompts, PromptsProps } from "@ant-design/x"; // Component library for interactive prompts
import { GetProp, Space } from "antd";

// A helper to display a title with an icon in a neat horizontal layout
const renderTitle = (icon: React.ReactElement, title: string) => (
    <Space align="start">
      {icon}
      <span>{title}</span>
    </Space>
  );

export const senderPromptsItems: GetProp<typeof Prompts, 'items'> = [];

// Defines categorized, hierarchical prompt groups
export const firstScreenPrompts: PromptsProps['items'] = [
  // Shows important things a user might want to know right away
    {
      key: '1',
      children: [
        {
        key: '2',
        description: 'How many projects are currently in progress',
        icon: <FireOutlined style={{ color: '#FF4D4F' }} />,
        }
      ]
    }
  ];