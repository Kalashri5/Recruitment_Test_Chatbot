import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
// V-- IMPORT THE NEW RESPONSE TYPE
import { ChatService, ChatResponse } from '../services/chatService';
import { Message } from '../types';
import './RecruitmentChatbot.css';

interface RecruitmentChatbotProps {
  jobId: string;
  jobTitle: string;
}

const SUGGESTED_QUESTIONS = [
  "How many total jobs are posted?",
  "Show me all active job openings",
  "Top 10 candidates by score",
  "Find candidate: harshavardhan.6962@gmail.com",
  "List all clients",
  "Candidates scoring above 80",
  "Show candidates expecting salary below ₹20L",
  "Which candidates have been selected?",
  "List rejected candidates with reasons",
  "Candidates in Bangalore",
  "Show PWC client details",
  "Who's in screening status?",
  "What are the job statuses available?",
  "Show all job openings in Bangalore",
  "Candidates with more than 5 years experience",
];

export const RecruitmentChatbot: React.FC<RecruitmentChatbotProps> = ({ jobId, jobTitle }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hi! 👋 I'm your AI recruitment assistant for **${jobTitle}**.\n\nI can help you with:\n• **Job queries** - Status, openings, details\n• **Candidate search** - By name, email, phone, skills, experience\n• **Client information** - Details, contacts, projects\n• **Pipeline tracking** - Status updates, timeline\n• **Analytics & Reports** - Insights, metrics, trends\n• **Resume analysis** - Skill matching, scoring\n\nTry asking me anything - I have access to all your recruitment data!`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [quickReplies, setQuickReplies] = useState<string[]>([]); // <-- ADDED THIS NEW STATE
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
    setQuickReplies([]); // <-- ADDED: Clear old replies when sending a new message

    try {
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // V-- THIS ENTIRE BLOCK HAS BEEN MODIFIED TO HANDLE THE NEW RESPONSE TYPE --V
      const response: ChatResponse = await ChatService.sendMessage(textToSend, jobId, conversationHistory);

      let messageContent: string;
      let newQuickReplies: string[] = [];

      // Check if the response is an object with suggestions
      if (typeof response === 'object' && 'suggestions' in response) {
        messageContent = response.text;
        newQuickReplies = response.suggestions;
      } else {
        // Otherwise, it's just a regular string
        messageContent = response;
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: messageContent, // This is now guaranteed to be a string
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setQuickReplies(newQuickReplies); // Set the new quick replies
      // ^-- END OF MODIFIED BLOCK --^

    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Please check your API keys and database connection.`,
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

  // <-- ADDED THIS ENTIRE NEW HANDLER FUNCTION FOR QUICK REPLIES -->
  const handleQuickReplyClick = (replyText: string) => {
    handleSend(replyText);
  };

  const handleClearChat = () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      setMessages([
        {
          role: 'assistant',
          content: `Hi! 👋 I'm your AI recruitment assistant for **${jobTitle}**.\n\nI can help you with:\n• **Job queries** - Status, openings, details\n• **Candidate search** - By name, email, phone, skills, experience\n• **Client information** - Details, contacts, projects\n• **Pipeline tracking** - Status updates, timeline\n• **Analytics & Reports** - Insights, metrics, trends\n• **Resume analysis** - Skill matching, scoring\n\nTry asking me anything - I have access to all your recruitment data!`,
          timestamp: new Date(),
        },
      ]);
      setShowSuggestions(true);
      setQuickReplies([]); // <-- ADDED: Clear replies on reset
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

      {/* V-- ADDED THIS ENTIRE NEW JSX BLOCK FOR QUICK REPLIES --V */}
      {quickReplies.length > 0 && !loading && (
        <div className="quick-replies-container">
          {quickReplies.map((reply, index) => (
            <button
              key={index}
              className="quick-reply-btn"
              onClick={() => handleQuickReplyClick(reply)}
            >
              {reply}
            </button>
          ))}
        </div>
      )}
      {/* ^-- END OF NEW JSX BLOCK --^ */}

      <div className="input-container">
        <div className="input-wrapper">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about jobs, candidates, clients, skills, experience, analytics..."
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