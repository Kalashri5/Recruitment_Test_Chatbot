import React, { useState, useEffect } from 'react';
import { RecruitmentChatbot } from './components/RecruitmentChatbot';
import { ChatService } from './services/chatService';
import { Loader2, Briefcase } from 'lucide-react';
import './App.css';

function App() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      console.log('🔍 Fetching jobs from Supabase...');
      const jobsData = await ChatService.getAllJobs();
      console.log('✅ Jobs fetched:', jobsData);
      console.log('📊 Number of jobs:', jobsData.length);
      
      setJobs(jobsData);
    } catch (error) {
      console.error('🚨 Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <Loader2 className="spinner" size={48} />
        <p>Loading recruitment data...</p>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <div className="app-header">
        <div className="app-header-content">
          <div className="app-logo">
            <Briefcase size={24} />
          </div>
          <div>
            <h1 className="app-title">hrumbles.ai</h1>
            <p className="app-subtitle">AI-Powered Recruitment Assistant</p>
          </div>
        </div>
      </div>

      <div className="app-content">
        {jobs.length > 0 ? (
          <RecruitmentChatbot
            jobId="all"
            jobTitle="All Positions"
          />
        ) : (
          <div className="no-jobs">
            <Briefcase size={64} />
            <h3>No Jobs Available</h3>
            <p>Please add jobs to your Supabase database to start using the chatbot.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;