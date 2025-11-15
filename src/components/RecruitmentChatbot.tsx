import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { ChatService } from '../services/chatService';
import { Message } from '../types';
import './RecruitmentChatbot.css';

interface RecruitmentChatbotProps {
  jobId: string;
  jobTitle: string;
}

const SUGGESTED_QUESTIONS = [
  "How many total jobs are posted?",
  "How many total candidates have applied?",
  "Top 10 candidates by score",
  "Find candidate: harshavardhan.6962@gmail.com",
  "Search phone: 9700226962",
  "Show me Dialogflow CX Developer candidates",
  "List all clients",
  "Candidates scoring above 80",
  "Show candidates expecting salary below ₹20L",
  "Which candidates have been selected?",
  "List rejected candidates with reasons",
  "Candidates in Bangalore",
  "Show PWC client details",
  "Who's in screening status?",
  "What are the job statuses available?",
];

export const RecruitmentChatbot: React.FC<RecruitmentChatbotProps> = ({ jobId, jobTitle }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hi! 👋 I'm your recruitment assistant for **${jobTitle}**.\n\nI can help you:\n• Search candidates by email or phone\n• Analyze candidate data and scores\n• Check statistics and metrics\n• Find specific jobs or clients\n• Filter by location, salary, or skills\n\nTry one of the suggested questions below or ask me anything!`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

const handleSend = async (messageText?: string) => {
  const textToSend = messageText || input;
  if (!textToSend.trim() || loading) return;

  const userMessage: Message = {
    role: 'user',
    content: textToSend,
    timestamp: new Date(),
  };

  setMessages((prev) => [...prev, userMessage]);
  setInput('');
  setLoading(true);
  setShowSuggestions(false);

  try {
    // 🔥 NEW: Send conversation history
    const conversationHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    const response = await ChatService.sendMessage(textToSend, jobId, conversationHistory);

    const assistantMessage: Message = {
      role: 'assistant',
      content: response,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
  } catch (error: any) {
    console.error('Chat error:', error);
    const errorMessage: Message = {
      role: 'assistant',
      content: `Sorry, I encountered an error: ${error.message}. Please check your API keys and try again.`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, errorMessage]);
  } finally {
    setLoading(false);
  }
};

  const handleSuggestedQuestion = (question: string) => {
    handleSend(question);
  };

  const handleClearChat = () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      setMessages([
        {
          role: 'assistant',
          content: `Hi! 👋 I'm your recruitment assistant for **${jobTitle}**.\n\nI can help you:\n• Search candidates by email or phone\n• Analyze candidate data and scores\n• Check statistics and metrics\n• Find specific jobs or clients\n• Filter by location, salary, or skills\n\nTry one of the suggested questions below or ask me anything!`,
          timestamp: new Date(),
        },
      ]);
      setShowSuggestions(true);
      ChatService.clearCache();
    }
  };

  const formatMessage = (content: string) => {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div className="chatbot-container">
      <div className="chatbot-header">
        <div className="header-content">
          <div className="avatar-wrapper">
            <div className="bot-avatar">
              <Bot size={28} />
            </div>
            <Sparkles className="sparkle-icon" size={16} />
          </div>
          <div className="header-text">
            <h3 className="header-title">Recruitment Assistant</h3>
            <p className="header-subtitle">{jobTitle}</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            onClick={handleClearChat}
            className="clear-chat-btn"
            title="Clear chat history"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="toggle-suggestions-btn"
          >
            {showSuggestions ? 'Hide' : 'Show'} Suggestions
            {showSuggestions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {showSuggestions && (
        <div className="suggestions-container">
          <p className="suggestions-title">
            <Sparkles size={16} />
            Suggested Questions - Click to ask
          </p>
          <div className="suggestions-grid">
            {SUGGESTED_QUESTIONS.map((question, index) => (
              <button
                key={index}
                onClick={() => handleSuggestedQuestion(question)}
                disabled={loading}
                className="suggestion-btn"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="messages-container">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
          >
            <div className={`message-avatar ${message.role === 'user' ? 'avatar-user' : 'avatar-assistant'}`}>
              {message.role === 'user' ? <User size={20} /> : <Bot size={20} />}
            </div>
            <div className={`message-bubble ${message.role === 'user' ? 'bubble-user' : 'bubble-assistant'}`}>
              <div
                className="message-content"
                dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }}
              />
              <p className="message-time">
                {message.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="message message-assistant">
            <div className="message-avatar avatar-assistant">
              <Bot size={20} />
            </div>
            <div className="message-bubble bubble-assistant">
              <div className="loading-indicator">
                <Loader2 className="spinner" size={16} />
                <span>Analyzing data...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <div className="input-wrapper">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about candidates, skills, experience, statistics..."
            className="chat-input"
            disabled={loading}
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            className="send-btn"
          >
            {loading ? (
              <Loader2 className="spinner" size={20} />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
        <p className="input-hint">Press Enter to send • Shift + Enter for new line</p>
      </div>
    </div>
  );
};