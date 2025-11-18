import { supabaseChatbot as supabase } from '../lib/supabaseChatbot';
import { EmbeddingService } from './embeddingService';

const responseCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export type ChatResponse = string | {
  text: string;
  suggestions: string[];
};

export class ChatService {
  // ============================================
  // IMPROVED QUERY CLASSIFICATION
  // ============================================
  
  static classifyQuery(query: string): {
    type: 'greeting' | 'recruitment' | 'off_topic' | 'help' | 'unclear';
    confidence: number;
  } {
    const lowerQuery = query.toLowerCase().trim();
    
    // Greetings
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'greetings'];
    if (greetings.some(g => lowerQuery === g || lowerQuery.startsWith(g + ' '))) {
      return { type: 'greeting', confidence: 1.0 };
    }
    
    // Help requests
    const helpKeywords = ['help', 'what can you do', 'how do you work', 'capabilities', 'features'];
    if (helpKeywords.some(kw => lowerQuery.includes(kw))) {
      return { type: 'help', confidence: 0.9 };
    }
    
    // Recruitment-related keywords
    const recruitmentKeywords = [
      'candidate', 'job', 'position', 'opening', 'vacancy', 'role', 'hire', 'hiring',
      'resume', 'cv', 'skill', 'experience', 'interview', 'status', 'application',
      'salary', 'ctc', 'compensation', 'location', 'qualification', 'education',
      'client', 'project', 'screening', 'selected', 'rejected', 'pipeline',
      'analytics', 'report', 'metrics', 'jd', 'job description', 'profile'
    ];
    
    const hasRecruitmentKeyword = recruitmentKeywords.some(kw => lowerQuery.includes(kw));
    
    // Check for email, phone, or other identifiers
    const hasIdentifier = this.extractEmail(query) || this.extractPhone(query) || this.extractJobId(query);
    
    if (hasRecruitmentKeyword || hasIdentifier) {
      return { type: 'recruitment', confidence: 0.9 };
    }
    
    // Check if it's a name (proper noun pattern)
    const namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/;
    if (namePattern.test(query) && query.split(' ').length <= 5) {
      return { type: 'recruitment', confidence: 0.7 };
    }
    
    // If query is very short and vague
    if (query.split(' ').length <= 3 && !hasRecruitmentKeyword) {
      return { type: 'unclear', confidence: 0.5 };
    }
    
    // Default to off-topic
    return { type: 'off_topic', confidence: 0.8 };
  }

  // ============================================
  // STATISTICS
  // ============================================
  
  static async getStats() {
    try {
      const [
        { count: jobCount },
        { count: candidateCount },
        { count: clientCount },
        { count: contactCount },
        { count: statusCount },
      ] = await Promise.all([
        supabase.from('hr_jobs').select('*', { count: 'exact', head: true }),
        supabase.from('hr_job_candidates').select('*', { count: 'exact', head: true }),
        supabase.from('hr_clients').select('*', { count: 'exact', head: true }),
        supabase.from('hr_client_contacts').select('*', { count: 'exact', head: true }),
        supabase.from('job_statuses').select('*', { count: 'exact', head: true }),
      ]);

      const { data: candidates } = await supabase
        .from('hr_job_candidates')
        .select('overall_score, status, interview_result')
        .not('overall_score', 'is', null);

      const averageScore = candidates && candidates.length > 0
        ? (candidates.reduce((sum, c) => sum + (c.overall_score || 0), 0) / candidates.length).toFixed(1)
        : '0';

      return {
        totalJobs: jobCount || 0,
        totalCandidates: candidateCount || 0,
        totalClients: clientCount || 0,
        totalContacts: contactCount || 0,
        totalStatuses: statusCount || 0,
        averageCandidateScore: averageScore,
        screening: candidates?.filter(c => c.status === 'Screening').length || 0,
        selected: candidates?.filter(c => c.interview_result === 'selected').length || 0,
        rejected: candidates?.filter(c => c.interview_result === 'rejected').length || 0,
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        totalJobs: 0,
        totalCandidates: 0,
        totalClients: 0,
        totalContacts: 0,
        totalStatuses: 0,
        averageCandidateScore: '0',
        screening: 0,
        selected: 0,
        rejected: 0,
      };
    }
  }

  // ============================================
  // HELPER FUNCTIONS - PATTERN EXTRACTION
  // ============================================

  static parseExperience(experienceText: string): number {
    if (!experienceText) return 0;
    const yearMatch = experienceText.match(/(\d+)\s*year/i);
    const monthMatch = experienceText.match(/(\d+)\s*month/i);
    const years = yearMatch ? parseInt(yearMatch[1]) : 0;
    const months = monthMatch ? parseInt(monthMatch[1]) : 0;
    return years + (months / 12);
  }

  static extractEmail(query: string): string | null {
    const match = query.match(/[\w.-]+@[\w.-]+\.\w+/);
    return match ? match[0] : null;
  }

  static extractPhone(query: string): string | null {
    const match = query.match(/(\+91)?[\s-]?([6-9]\d{9})/);
    return match ? match[2] : null;
  }

  static extractJobId(query: string): string | null {
    const match = query.match(/([A-Z]{2,4}\d+)/i);
    return match ? match[0].toUpperCase() : null;
  }

  static extractExperience(query: string): { years: number; operator: 'lt' | 'gt' } | null {
    const match = query.match(/(?:above|more than|over|greater than|>)\s*(\d+)\s*year|(?:less than|below|under|<)\s*(\d+)\s*year/i);
    if (match) {
      const years = parseInt(match[1] || match[2]);
      const operator = query.toLowerCase().includes('above') || 
                       query.toLowerCase().includes('more') || 
                       query.toLowerCase().includes('over') ||
                       query.toLowerCase().includes('greater') ? 'gt' : 'lt';
      return { years, operator };
    }
    return null;
  }

  static extractSalary(query: string): { amount: number; operator: 'lt' | 'gt' } | null {
    const match = query.match(/(\d+)\s*(l|lakh|lpa)/i);
    if (!match) return null;
    const amount = parseInt(match[1]) * 100000;
    const operator = query.includes('below') || query.includes('under') ? 'lt' : 'gt';
    return { amount, operator };
  }

  static extractScore(query: string): { score: number; operator: 'lt' | 'gt' } | null {
    const match = query.match(/score\s*(above|below|over|under|>|<)\s*(\d+)/i);
    if (!match) return null;
    const score = parseInt(match[2]);
    const operator = match[1].match(/(below|under|<)/) ? 'lt' : 'gt';
    return { score, operator };
  }

  static extractSkill(query: string): string | null {
    const skillKeywords = [
      'javascript', 'typescript', 'react', 'node', 'python', 'java', 
      'dialogflow', 'playwright', 'aws', 'azure', 'gcp', 'servicenow', 'service now',
      'sql', 'mongodb', 'kubernetes', 'docker', 'angular', 'vue',
      'sap', 'fico', 'abap', 'hana', 'erp', 'crm', 'power bi', 'powerbi',
      'tableau', 'excel', 'data science', 'machine learning', 'ml',
      'ai', 'artificial intelligence', 'deep learning', 'nlp',
      'c++', 'c#', 'golang', 'rust', 'php', 'ruby', 'scala',
      'jenkins', 'gitlab', 'github', 'devops', 'ci/cd', 'cicd',
      'sap fico', 'sap mm', 'sap sd', 'sap hana', 'sap abap'
    ];
    
    const lowerQuery = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Remove special chars
      .replace(/\s+/g, ' ')       // Normalize spaces
      .trim();
    
    // Find longest matching skill first (to match "data science" before "data")
    const matches = skillKeywords
      .filter(skill => lowerQuery.includes(skill))
      .sort((a, b) => b.length - a.length);
    
    return matches.length > 0 ? matches[0] : null;
  }

  static extractJobTitle(query: string): string | null {
    const jobTitles = [
      'data scientist', 'data analyst', 'data engineer',
      'software engineer', 'software developer', 'developer',
      'full stack', 'fullstack', 'frontend', 'front end', 'backend', 'back end',
      'devops engineer', 'devops',
      'sap consultant', 'sap fico', 'sap mm', 'sap sd', 'sap hana', 'sap abap',
      'business analyst', 'business intelligence',
      'project manager', 'product manager',
      'qa engineer', 'quality assurance', 'tester',
      'ui/ux designer', 'ux designer', 'ui designer',
      'cloud architect', 'solution architect', 'technical architect',
      'machine learning engineer', 'ml engineer', 'ai engineer',
      'data analyst', 'mis executive', 'mis analyst',
      'accounts executive', 'accountant', 'finance manager'
    ];
    
    const lowerQuery = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Find longest matching title first
    const matches = jobTitles
      .filter(title => lowerQuery.includes(title))
      .sort((a, b) => b.length - a.length);
    
    return matches.length > 0 ? matches[0] : null;
  }

  // New: Typo-tolerant search helper
  static normalizeForSearch(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // New: Calculate similarity for typo tolerance
  static calculateSimilarity(str1: string, str2: string): number {
    const s1 = this.normalizeForSearch(str1);
    const s2 = this.normalizeForSearch(str2);
    
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    
    // Simple character overlap
    const chars1 = new Set(s1.split(''));
    const chars2 = new Set(s2.split(''));
 const intersection = new Set(Array.from(chars1).filter(x => chars2.has(x)));
const union = new Set([...Array.from(chars1), ...Array.from(chars2)]);
    
    return intersection.size / union.size;
  }

  static extractNameFromHistory(conversationHistory: Array<{role: string, content: string}>): string | null {
    const recentAssistant = conversationHistory.filter(m => m.role === 'assistant').slice(-3);
    
    for (const msg of recentAssistant) {
      const boldNameMatch = msg.content.match(/\*\*([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\*\*/);
      if (boldNameMatch) {
        console.log('📝 Extracted name from history:', boldNameMatch[1]);
        return boldNameMatch[1];
      }
      
      const emailMatch = msg.content.match(/Email:\s*[\w.-]+@[\w.-]+\.\w+/i);
      const nameBeforeEmail = msg.content.match(/(?:Candidate|Name):\s*\*\*([A-Z][a-z]+\s+[A-Z][a-z]+)\*\*/i);
      if (emailMatch && nameBeforeEmail) {
        console.log('📝 Extracted name near email:', nameBeforeEmail[1]);
        return nameBeforeEmail[1];
      }
    }
    
    return null;
  }

  static extractNameFromQuery(query: string): string | null {
    const patterns = [
      /(?:similar to|like|candidates like)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /(?:find|show|get)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:profile|details|information)/i
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  static extractRequestedCount(query: string): number | null {
    // Extract numbers from queries like "show top 10", "give me 15 candidates", "list 20", etc.
    const patterns = [
      /(?:top|first|best|show|list|give me|find)\s+(\d+)/i,
      /(\d+)\s+(?:candidates|jobs|clients|people|profiles)/i,
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        const count = parseInt(match[1]);
        // Reasonable limits
        if (count >= 1 && count <= 100) {
          return count;
        }
      }
    }
    
    return null;
  }

  // ============================================
  // RAG DETECTION
  // ============================================

  static shouldUseSemanticSearch(query: string): boolean {
    const semanticKeywords = [
      'similar to',
      'like',
      'candidates with expertise in',
      'find someone who',
      'looking for',
      'good fit for',
      'experience in',
      'background in',
      'specializes in',
      'expert in',
      'proficient in',
      'skilled in',
      'who knows',
      'familiar with'
    ];
    
    const lowerQuery = query.toLowerCase();
    return semanticKeywords.some(kw => lowerQuery.includes(kw));
  }

  // ============================================
  // SMART SEARCH - HYBRID (SQL + VECTOR)
  // ============================================

  static async smartSearch(query: string, conversationHistory: Array<{role: string, content: string}> = [], requestedLimit?: number | null) {
    const lowerQuery = query.toLowerCase();
    const defaultLimit = requestedLimit || 20; // Use requested limit or default to 20

    try {
      // SPECIAL: "TOP X CANDIDATES OF/FOR Y" pattern (Fixed for arrays + typo tolerance)
      const topCandidatesOfPattern = /(?:top|best|show|list|find)\s+(\d+)?\s*(?:candidates?)?\s+(?:of|for|with|in)\s+(.+)/i;
      const topMatch = query.match(topCandidatesOfPattern);
      if (topMatch) {
        const count = topMatch[1] ? parseInt(topMatch[1]) : defaultLimit;
        const searchTerm = topMatch[2].trim();
        console.log(`🔍 Special pattern: top ${count} candidates of/for "${searchTerm}"`);
        
        // Fetch all candidates with scores
        const { data: allCandidates } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .not('overall_score', 'is', null)
          .order('overall_score', { ascending: false })
          .limit(200); // Fetch more, filter client-side
        
        if (allCandidates && allCandidates.length > 0) {
          const matchedCandidates = allCandidates.filter(candidate => {
            const fieldsToCheck = [
              candidate.skills ? (Array.isArray(candidate.skills) ? candidate.skills.join(' ') : candidate.skills) : '',
              candidate.experience || '',
              candidate.resume_text || ''
            ];
            
            const searchNormalized = this.normalizeForSearch(searchTerm);
            
            return fieldsToCheck.some(field => {
              const normalized = this.normalizeForSearch(field);
              
              // Contains match
              if (normalized.includes(searchNormalized)) return true;
              
              // Typo tolerance - check each word
              const words = searchNormalized.split(' ');
              return words.every(word => {
                if (normalized.includes(word)) return true;
                // Allow some typos
                return this.calculateSimilarity(normalized, word) > 0.7;
              });
            });
          });
          
          const topResults = matchedCandidates.slice(0, count);
          
          if (topResults.length > 0) {
            console.log(`✅ Found ${topResults.length} top candidates for "${searchTerm}"`);
            return { 
              type: 'top_candidates_for_skill', 
              data: { 
                candidates: topResults, 
                searchTerm, 
                requestedCount: count 
              } 
            };
          }
        }
        
        console.log(`⚠️ No candidates found for: ${searchTerm}`);
      }

      // SPECIAL: "TOP X CANDIDATES" without specific criteria - sort by score
      const topCandidatesPattern = /(?:top|best|highest)\s+\d+\s*(?:candidates?)?/i;
      if (topCandidatesPattern.test(lowerQuery) && !this.extractEmail(query) && !this.extractPhone(query) && !this.extractSkill(query)) {
        console.log('🔍 Top candidates by score:', defaultLimit);
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .not('overall_score', 'is', null)
          .order('overall_score', { ascending: false })
          .limit(defaultLimit);
        if (data && data.length > 0) return { type: 'top_candidates', data: { candidates: data } };
      }

      // SPECIAL: "ALL CANDIDATES" without filters
      const allCandidatesPattern = /(?:all|every|show)\s+(?:the\s+)?candidates?(?:\s+list)?$/i;
      if (allCandidatesPattern.test(lowerQuery) && !this.extractEmail(query) && !this.extractPhone(query) && !this.extractSkill(query)) {
        console.log('🔍 All candidates (limited to', defaultLimit, ')');
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
.order('overall_score', { ascending: false, nullsFirst: false })
          .limit(defaultLimit);
        if (data && data.length > 0) return { type: 'all_candidates', data: { candidates: data } };
      }

      // FOLLOW-UP QUESTION DETECTION
      const followUpKeywords = ['applied', 'date', 'when', 'status', 'interview', 'skills', 'experience', 'salary', 'their', 'his', 'her', 'what about', 'tell me more'];
      const isFollowUp = followUpKeywords.some(kw => lowerQuery.includes(kw)) && 
                         lowerQuery.split(' ').length < 8 && 
                         !this.extractEmail(query) && 
                         !this.extractPhone(query);
      
      if (isFollowUp && conversationHistory.length > 0) {
        const contextName = this.extractNameFromHistory(conversationHistory);
        if (contextName) {
          console.log('🔍 Follow-up question detected. Searching for:', contextName);
          const { data } = await supabase
            .from('hr_job_candidates')
            .select('*')
            .ilike('name', `%${contextName}%`)
            .limit(5);
          
          if (data && data.length > 0) {
            return { type: 'candidate_followup', data: { candidates: data, contextName } };
          }
        }
      }

      // 1. EMAIL SEARCH
      const email = this.extractEmail(query);
      if (email) {
        console.log('🔍 Email search:', email);
        const { data } = await supabase.from('hr_job_candidates').select('*').eq('email', email);
        if (data && data.length > 0) {
          return { type: 'candidate_full_details', data: { candidates: data } };
        }
      }

      // 2. PHONE SEARCH
      const phone = this.extractPhone(query);
      if (phone) {
        console.log('🔍 Phone search:', phone);
        const { data } = await supabase.from('hr_job_candidates').select('*').ilike('phone', `%${phone}%`);
        if (data && data.length > 0) return { type: 'candidate_full_details', data: { candidates: data } };
      }

      // 3. JOB ID SEARCH
      const jobId = this.extractJobId(query);
      if (jobId) {
        console.log('🔍 Job ID search:', jobId);
        const { data } = await supabase.from('hr_jobs').select('*').eq('job_id', jobId);
        if (data && data.length > 0) return { type: 'job_details', data: { jobs: data } };
      }

      // 4. SEMANTIC/RAG SEARCH
      if (this.shouldUseSemanticSearch(query)) {
        console.log('🧠 Using RAG/Semantic search');
        try {
          const semanticResults = await EmbeddingService.searchSimilarCandidates(query, 10, 0.7);
          
          if (semanticResults && semanticResults.length > 0) {
            return { 
              type: 'semantic_search', 
              data: { 
                candidates: semanticResults,
                searchMethod: 'vector_similarity'
              } 
            };
          }
        } catch (error) {
          console.warn('⚠️ Semantic search failed, falling back to SQL:', error);
        }
      }

      // 5. EXPERIENCE FILTER
      const experienceFilter = this.extractExperience(query);
      if (experienceFilter) {
        console.log('🔍 Experience filter:', experienceFilter);
        const { data: allCandidates } = await supabase.from('hr_job_candidates').select('*').not('experience', 'is', null);
        const filtered = allCandidates?.map(c => ({ ...c, experienceYears: this.parseExperience(c.experience || '') })).filter(c => experienceFilter.operator === 'gt' ? c.experienceYears > experienceFilter.years : c.experienceYears < experienceFilter.years).slice(0, 30) || [];
        if (filtered.length > 0) return { type: 'candidates_by_experience', data: { candidates: filtered } };
      }

      // 6. SCORE FILTER
      const scoreFilter = this.extractScore(query);
      if (scoreFilter) {
        console.log('🔍 Score filter:', scoreFilter);
        const { data } = await supabase.from('hr_job_candidates').select('*').not('overall_score', 'is', null).filter('overall_score', scoreFilter.operator === 'gt' ? 'gte' : 'lte', scoreFilter.score).order('overall_score', { ascending: false }).limit(defaultLimit);
        if (data && data.length > 0) return { type: 'candidates_by_score', data: { candidates: data } };
      }

      // 7. SALARY FILTER
      const salaryFilter = this.extractSalary(query);
      if (salaryFilter) {
        console.log('🔍 Salary filter:', salaryFilter);
        const { data } = await supabase.from('hr_job_candidates').select('*').not('expected_salary', 'is', null).filter('expected_salary', salaryFilter.operator === 'gt' ? 'gte' : 'lte', salaryFilter.amount).limit(defaultLimit);
        if (data && data.length > 0) return { type: 'candidates_by_salary', data: { candidates: data } };
      }

      // 8. SKILL SEARCH (Fixed for array fields)
      const skill = this.extractSkill(query);
      if (skill) {
        console.log('🔍 Skill search:', skill);
        
        // Fetch candidates and filter client-side (because skills is an array)
        const { data: allCandidates } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .limit(100); // Fetch more, filter client-side
        
        if (allCandidates && allCandidates.length > 0) {
          // Filter candidates that have the skill (with typo tolerance)
          const matchedCandidates = allCandidates.filter(candidate => {
            if (!candidate.skills) return false;
            
            // Handle both array and string skills
            const skillsArray = Array.isArray(candidate.skills) 
              ? candidate.skills 
              : [candidate.skills];
            
            // Check if any skill matches (with typo tolerance)
           return skillsArray.some((candidateSkill: string) => {
              const normalized = this.normalizeForSearch(candidateSkill);
              const searchNormalized = this.normalizeForSearch(skill);
              
              // Exact or contains match
              if (normalized.includes(searchNormalized) || searchNormalized.includes(normalized)) {
                return true;
              }
              
              // Typo tolerance - similarity > 0.7
              return this.calculateSimilarity(normalized, searchNormalized) > 0.7;
            });
          });
          
          const limitedResults = matchedCandidates.slice(0, defaultLimit);
          
          if (limitedResults.length > 0) {
            console.log(`✅ Found ${limitedResults.length} candidates with ${skill}`);
            return { type: 'candidates_by_skill', data: { candidates: limitedResults } };
          }
        }
        
        console.log(`⚠️ No candidates found with skill: ${skill}`);
      }

      // 8.5. JOB TITLE/ROLE SEARCH (Fixed for better matching)
      const jobTitle = this.extractJobTitle(query);
      if (jobTitle) {
        console.log('🔍 Job title search:', jobTitle);
        
        // Fetch all candidates and filter client-side for better matching
        const { data: allCandidates } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .limit(100);
        
        if (allCandidates && allCandidates.length > 0) {
          const matchedCandidates = allCandidates.filter(candidate => {
            // Check in multiple fields with typo tolerance
            const fieldsToCheck = [
              candidate.skills ? (Array.isArray(candidate.skills) ? candidate.skills.join(' ') : candidate.skills) : '',
              candidate.experience || '',
              candidate.resume_text || '',
              candidate.name || ''
            ];
            
            const searchNormalized = this.normalizeForSearch(jobTitle);
            
            return fieldsToCheck.some(field => {
              const normalized = this.normalizeForSearch(field);
              
              // Contains match
              if (normalized.includes(searchNormalized)) return true;
              
              // Typo tolerance
              const words = searchNormalized.split(' ');
              return words.every(word => 
                normalized.includes(word) || 
                this.calculateSimilarity(normalized, word) > 0.7
              );
            });
          });
          
          const limitedResults = matchedCandidates.slice(0, defaultLimit);
          
          if (limitedResults.length > 0) {
            console.log(`✅ Found ${limitedResults.length} candidates for ${jobTitle}`);
            return { type: 'candidates_by_job_title', data: { candidates: limitedResults } };
          }
        }
        
        // Also search in jobs table
        const { data: allJobs } = await supabase
          .from('hr_jobs')
          .select('*')
          .limit(50);
        
        if (allJobs && allJobs.length > 0) {
          const matchedJobs = allJobs.filter(job => {
            const fieldsToCheck = [
              job.title || '',
              Array.isArray(job.skills) ? job.skills.join(' ') : (job.skills || ''),
              job.description || ''
            ];
            
            const searchNormalized = this.normalizeForSearch(jobTitle);
            
            return fieldsToCheck.some(field => {
              const normalized = this.normalizeForSearch(field);
              return normalized.includes(searchNormalized);
            });
          });
          
          const limitedJobs = matchedJobs.slice(0, defaultLimit);
          
          if (limitedJobs.length > 0) {
            console.log(`✅ Found ${limitedJobs.length} jobs for ${jobTitle}`);
            return { type: 'jobs_by_title', data: { jobs: limitedJobs } };
          }
        }
        
        console.log(`⚠️ No results found for job title: ${jobTitle}`);
      }
      
      // 9. STATUS QUERIES
      const statusKeywords = { 
        screening: ['screening', 'reviewing', 'in review'], 
        selected: ['selected', 'hired', 'accepted', 'passed', 'succeeded'], 
        rejected: ['rejected', 'declined', 'failed', 'not selected'], 
        interview: ['interview', 'interviewing', 'scheduled'],
        offered: ['offered', 'offer', 'offer stage']
      };
      let matchedStatusKey: string | null = null;
      for (const key in statusKeywords) {
        if (statusKeywords[key as keyof typeof statusKeywords].some(kw => lowerQuery.includes(kw))) {
          matchedStatusKey = key;
          break;
        }
      }
      if (matchedStatusKey) {
        console.log('🔍 Status filter:', matchedStatusKey);
        const column = ['screening', 'offered'].includes(matchedStatusKey) ? 'status' : 'interview_result';
        const statusValue = matchedStatusKey.charAt(0).toUpperCase() + matchedStatusKey.slice(1);
        const { data } = await supabase.from('hr_job_candidates').select('*').eq(column, statusValue).limit(defaultLimit);
        if (data && data.length > 0) return { type: 'candidates_by_status', data: { candidates: data } };
      }

      // 10. LOCATION SEARCH
      const locations = ['bangalore', 'bengaluru', 'chennai', 'hyderabad', 'pune', 'mumbai', 'delhi', 'coimbatore'];
      const matchedLocation = locations.find(loc => lowerQuery.includes(loc));
      if (matchedLocation) {
        console.log('🔍 Location search:', matchedLocation);
        const { data } = await supabase.from('hr_job_candidates').select('*').ilike('location', `%${matchedLocation}%`).limit(defaultLimit);
        if (data && data.length > 0) return { type: 'candidates_by_location', data: { candidates: data } };
      }

      // 11. CLIENT SEARCH
      if (lowerQuery.includes('client')) {
        console.log('🔍 Client search');
        
        // Check if user wants active clients specifically
        const wantsActive = lowerQuery.includes('active');
        const wantsAll = lowerQuery.includes('all') || lowerQuery.includes('every');
        
        let clientQuery = supabase.from('hr_clients').select('*');
        
        if (wantsActive) {
          console.log('   -> Filtering for active clients');
          clientQuery = clientQuery.eq('status', 'Active');
        }
        
        // If they say "all", don't limit
        const clientLimit = wantsAll ? 100 : defaultLimit;
        const { data: clients } = await clientQuery.limit(clientLimit);
        
        // Get contacts for these clients
        const { data: contacts } = await supabase
          .from('hr_client_contacts')
          .select('*')
          .limit(clientLimit);
        
        if (clients && clients.length > 0) {
          return { 
            type: 'clients_and_contacts', 
            data: { 
              clients, 
              contacts,
              filter: wantsActive ? 'active_only' : 'all'
            } 
          };
        }
      }

      // 12. JOB SEARCH
      const jobKeywords = ['job', 'position', 'opening', 'vacancy', 'role'];
      if (jobKeywords.some(kw => lowerQuery.includes(kw))) {
        console.log('🔍 Job search');
        let jobQuery = supabase.from('hr_jobs').select('*');
        if (lowerQuery.includes('active') || lowerQuery.includes('open')) {
            console.log('   -> Filtering for active jobs');
            jobQuery = jobQuery.eq('status', 'Active');
        }
        const { data } = await jobQuery.limit(defaultLimit);
        if (data && data.length > 0) return { type: 'jobs', data: { jobs: data } };
      }

      // 13. STATUS TYPES
      if (lowerQuery.includes('status') && (lowerQuery.includes('type') || lowerQuery.includes('list') || lowerQuery.includes('available'))) {
        console.log('🔍 Status types');
        const { data } = await supabase.from('job_statuses').select('*').order('display_order');
        if (data && data.length > 0) return { type: 'job_statuses', data: { statuses: data } };
      }

      // 13.5. CATCH-ALL SKILL/ROLE SEARCH (Before name search)
      // This catches queries like "data scientist", "sap fico", etc. that didn't match above
      console.log('🔍 Catch-all skill/role search...');
      const searchTerms = lowerQuery
        .split(' ')
        .filter(word => word.length > 2 && !['the', 'show', 'find', 'list', 'give', 'get', 'me', 'all'].includes(word))
        .join(' ');
      
      if (searchTerms.length > 3) {
        console.log(`🔍 Searching for: "${searchTerms}"`);
        
        const { data: allCandidates } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .limit(100);
        
        if (allCandidates && allCandidates.length > 0) {
          const matchedCandidates = allCandidates.filter(candidate => {
            const fieldsToCheck = [
              candidate.skills ? (Array.isArray(candidate.skills) ? candidate.skills.join(' ') : candidate.skills) : '',
              candidate.experience || '',
              candidate.resume_text || ''
            ];
            
            const searchNormalized = this.normalizeForSearch(searchTerms);
            
            return fieldsToCheck.some(field => {
              const normalized = this.normalizeForSearch(field);
              
              // Direct contains
              if (normalized.includes(searchNormalized)) return true;
              
              // Word-by-word match with typo tolerance
              const searchWords = searchNormalized.split(' ');
              const matchedWords = searchWords.filter(word => {
                if (normalized.includes(word)) return true;
                // Typo tolerance
                const fieldWords = normalized.split(' ');
                return fieldWords.some(fw => this.calculateSimilarity(fw, word) > 0.75);
              });
              
              // Match if at least 70% of words found
              return matchedWords.length >= searchWords.length * 0.7;
            });
          });
          
          const sortedResults = matchedCandidates
            .sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0))
            .slice(0, defaultLimit);
          
          if (sortedResults.length > 0) {
            console.log(`✅ Catch-all found ${sortedResults.length} candidates`);
            return { 
              type: 'candidates_broad_search', 
              data: { 
                candidates: sortedResults, 
                searchTerm: searchTerms 
              } 
            };
          }
        }
      }
      
      // 14. NAME SEARCH (FALLBACK)
      console.log('🔍 Performing comprehensive name search...');
      const stopWords = ['can','get','give','details','of','about','show','find','the', 'list', 'all', 'are', 'who', 'hi', 'applied', 'date', 'when', 'top', 'best'];
      const potentialName = lowerQuery.split(' ').filter(word => !stopWords.includes(word) && word.length >= 2).join(' ').trim();
      
      if (potentialName) {
        console.log(`🔍 Searching for candidate: "${potentialName}"`);
        
        const { data: fullPhraseData } = await supabase.from('hr_job_candidates').select('*').ilike('name', `%${potentialName}%`);
        if (fullPhraseData && fullPhraseData.length > 0) {
            console.log(`✅ Found ${fullPhraseData.length} candidates.`);
            return { type: 'candidate_by_name_phrase', data: { candidates: fullPhraseData } };
        }

        const keywords = potentialName.split(' ');
        let candidateQuery = supabase.from('hr_job_candidates').select('*');
        keywords.forEach(kw => {
          candidateQuery = candidateQuery.ilike('name', `%${kw}%`);
        });
        const { data: andData } = await candidateQuery.limit(10);
        if (andData && andData.length > 0) {
            console.log(`✅ Found ${andData.length} candidates.`);
            return { type: 'candidate_by_name_keywords_and', data: { candidates: andData } };
        }

        const searchPattern = keywords.map(kw => `name.ilike.%${kw}%`).join(',');
        const { data: orData } = await supabase.from('hr_job_candidates').select('*').or(searchPattern).limit(10);
        if (orData && orData.length > 0) {
            console.log(`✅ Found ${orData.length} candidates.`);
            return { type: 'candidate_by_name_keywords_or', data: { candidates: orData } };
        }
        
        // LAST RESORT: Search in skills, experience, resume_text
        console.log(`🔍 Last resort: Searching in all fields for "${potentialName}"`);
        const { data: broadSearch } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .or(`skills.ilike.%${potentialName}%,experience.ilike.%${potentialName}%,resume_text.ilike.%${potentialName}%`)
          .limit(defaultLimit);
        
        if (broadSearch && broadSearch.length > 0) {
          console.log(`✅ Found ${broadSearch.length} candidates in broad search.`);
          return { type: 'candidates_broad_search', data: { candidates: broadSearch, searchTerm: potentialName } };
        }
      }

      return { type: 'no_results', data: null };
    } catch (error) {
      console.error('Smart search error:', error);
      return { type: 'error', data: null };
    }
  }
  
  // ============================================
  // RAG SPECIFIC FUNCTIONS
  // ============================================

  static formatSimilarCandidatesResponse(originalName: string, candidates: any[]): string {
    let response = `**Candidates similar to ${originalName}:**\n\n`;
    
    candidates.forEach((candidate, i) => {
      response += `${i + 1}. **${candidate.name}**`;
      if (candidate.similarity_score) {
        response += ` (${candidate.similarity_score}% match)`;
      }
      response += `\n`;
      response += `   • Experience: ${candidate.experience || 'N/A'}\n`;
      response += `   • Skills: ${(candidate.skills || '').substring(0, 100)}${candidate.skills?.length > 100 ? '...' : ''}\n`;
      response += `   • Score: ${candidate.overall_score || 'N/A'}/100\n`;
      response += `   • Email: ${candidate.email}\n`;
      response += `   • Location: ${candidate.location || 'N/A'}\n\n`;
    });
    
    return response;
  }

  static formatJDMatchResponse(matches: any[]): string {
    let response = `**🎯 Top ${matches.length} Matching Candidates** (Ranked by AI):\n\n`;
    
    matches.forEach((match, i) => {
      response += `${i + 1}. **${match.candidate_name}**`;
      if (match.similarity) {
        response += ` (${(match.similarity * 100).toFixed(1)}% match)`;
      }
      response += `\n`;
      response += `   • Email: ${match.candidate_email}\n`;
      if (match.overall_score) {
        response += `   • Score: ${match.overall_score}/100\n`;
      }
      response += `\n`;
    });
    
    response += `\n💡 *These candidates were matched using semantic analysis and vector similarity search.*`;
    
    return response;
  }

  // ============================================
  // JOB DESCRIPTION MATCHING
  // ============================================
  
  static async getRankedCandidatesFromJD(jobDescription: string): Promise<string> {
    try {
        console.log('🤖 Starting JD matching...');
        
        // TRY RAG FIRST
        try {
          const ragMatches = await EmbeddingService.matchCandidatesToJD(jobDescription, 15, 0.75);
          if (ragMatches && ragMatches.length > 0) {
            console.log('✅ Using RAG matching');
            return this.formatJDMatchResponse(ragMatches);
          }
        } catch (ragError) {
          console.warn('⚠️ RAG matching unavailable, using fallback method');
        }
        
        // FALLBACK: GPT-based matching
        const extractionPrompt = `Extract key criteria from this job description as JSON: { "skills": ["skill1", "skill2"], "experience": 5, "location": "City" }\n\nJob Description:\n${jobDescription}`;
        let apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: extractionPrompt }], temperature: 0.1 }),
        });
        if (!apiResponse.ok) throw new Error('AI extraction failed');
        let aiJson = await apiResponse.json();
        const rawContent = aiJson.choices[0].message.content;
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid AI response");
        const criteria = JSON.parse(jsonMatch[0]);

        const skillQuery = criteria.skills.map((skill: string) => `skills.ilike.%${skill}%`).join(',');
        const { data: candidates } = await supabase.from('hr_job_candidates').select('name, email, phone, experience, skills, overall_score, location, status').or(skillQuery).limit(30);
        if (!candidates || candidates.length === 0) return "No matching candidates found for this job description.";

        const rankingPrompt = `Rank these candidates for the job. Provide top 5 with suitability scores and justifications.\n\nJOB:\n${jobDescription}\n\nCANDIDATES:\n${JSON.stringify(candidates, null, 2)}`;
        apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: rankingPrompt }], temperature: 0.5, max_tokens: 1000 }),
        });
        if (!apiResponse.ok) throw new Error('AI ranking failed');
        aiJson = await apiResponse.json();
        return "**Top candidates for this role:**\n\n" + aiJson.choices[0].message.content;
    } catch (error: any) {
        console.error('❌ JD matching error:', error);
        return `Error analyzing job description: ${error.message}`;
    }
  }

  // ============================================
  // ANALYTICS
  // ============================================

  static async getAnalyticsReport(userQuery: string): Promise<string> {
    try {
        console.log('📊 Generating analytics...');
        let reportData: any = {};
        
        if (userQuery.includes('top jobs') || userQuery.includes('most applications')) {
            const { data, error } = await supabase.rpc('get_top_jobs_by_application_count', { limit_count: 5 });
            if (error) throw error;
            reportData.top_jobs_by_applications = data;
        } 
        
        if (userQuery.includes('pipeline') || userQuery.includes('candidate distribution')) {
            const { data, error } = await supabase.rpc('get_candidate_status_distribution');
            if (error) throw error;
            reportData.candidate_pipeline_distribution = data;
        }
        
        if (Object.keys(reportData).length === 0) {
            const { data: jobData } = await supabase.rpc('get_top_jobs_by_application_count', { limit_count: 5 });
            const { data: pipelineData } = await supabase.rpc('get_candidate_status_distribution');
            reportData = { summary_report: "General Recruitment Analytics", top_jobs_by_applications: jobData, candidate_pipeline_distribution: pipelineData };
        }

        const reportPrompt = `Create a concise analytics report from this data:\n${JSON.stringify(reportData, null, 2)}`;
        const apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: reportPrompt }], temperature: 0.5, max_tokens: 800 }),
        });
        if (!apiResponse.ok) throw new Error('Report generation failed');
        const aiJson = await apiResponse.json();
        return aiJson.choices[0].message.content;
    } catch (error: any) {
        console.error('❌ Analytics error:', error);
        return `Error generating report: ${error.message}. You may need to create SQL functions in Supabase.`;
    }
  }

  // ============================================
  // IMPROVED RESPONSE GENERATION
  // ============================================

  static generateSystemPrompt(
    queryType: 'greeting' | 'recruitment' | 'off_topic' | 'help' | 'unclear',
    stats: any,
    searchResults: any,
    conversationHistory: Array<{role: string, content: string}>,
    requestedCount?: number | null
  ): string {
    const conversationContext = conversationHistory.slice(-6)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const baseContext = `You are hrumbles.ai, a professional AI recruitment assistant.

DATABASE OVERVIEW:
• ${stats.totalJobs} jobs | ${stats.totalCandidates} candidates | ${stats.totalClients} clients
• Average Score: ${stats.averageCandidateScore}/100
• Pipeline: ${stats.screening} Screening, ${stats.selected} Selected, ${stats.rejected} Rejected

RECENT CONVERSATION:
${conversationContext || 'None'}`;

    if (queryType === 'greeting') {
      return `${baseContext}

TASK: Respond warmly and professionally to a greeting.

GUIDELINES:
1. Keep it brief and friendly
2. Offer to help with recruitment tasks
3. Don't list capabilities unless asked
4. Natural, conversational tone`;
    }

    if (queryType === 'help') {
      return `${baseContext}

TASK: Explain your capabilities clearly.

YOU CAN HELP WITH:
• **Candidate Search** - By name, email, phone, skills, experience, location
• **Job Information** - Active openings, job details, requirements
• **Client Details** - Company info, contacts, projects
• **Analytics** - Pipeline metrics, status distributions, reports
• **Filtering** - By salary, score, status, experience, skills
• **Semantic Search** - Find similar candidates based on profiles

RESPOND:
Briefly explain what you can do in a helpful, friendly way.`;
    }

    if (queryType === 'off_topic') {
      return `${baseContext}

TASK: The user asked something unrelated to recruitment.

RESPOND:
1. Acknowledge their question politely
2. Explain you're specialized in recruitment/HR tasks
3. Offer to help with recruitment-related queries
4. Keep it friendly and professional
5. Suggest what you CAN help with

EXAMPLE:
"I appreciate the question, but I'm specifically designed to help with recruitment and HR tasks. I can help you find candidates, check job openings, review client information, or provide analytics. What would you like to know about our recruitment data?"`;
    }

    if (queryType === 'unclear') {
      return `${baseContext}

TASK: The query is too vague to understand.

RESPOND:
1. Politely ask for clarification
2. Give 2-3 examples of what they might be asking
3. Keep it helpful and friendly

EXAMPLE:
"I'd be happy to help! Could you be more specific? For example, are you looking for:
• A specific candidate by name or email?
• Jobs in a particular location or skill area?
• Analytics or reports?
Let me know what you need!"`;
    }

    // recruitment query
    const searchContext = searchResults && searchResults.data && 
      (Object.values(searchResults.data).some((d: any) => Array.isArray(d) && d.length > 0))
      ? `\n\nSEARCH RESULTS (${searchResults.type}):\n${JSON.stringify(searchResults.data, null, 2)}`
      : `\n\nNo specific results found in database.`;

    const countInstruction = requestedCount 
      ? `\n\n🎯 IMPORTANT: User requested EXACTLY ${requestedCount} results. Show ${requestedCount} candidates/items, no more, no less.`
      : '';

    return `${baseContext}${searchContext}${countInstruction}

TASK: Answer the recruitment query using the search results above.

FORMATTING RULES:
1. **Complete Information**: Include name, email, phone, experience, score, status, salary, location, skills, applied date
2. **Bold Names**: Always use **bold** for candidate/job names
3. **Clear Structure**: Use bullet points for lists
4. **Currency**: Format as ₹X.XX LPA
5. **Scores**: Show as X/100
6. **Dates**: Format clearly (DD-MM-YYYY or "2 months ago")
7. **Similarity Scores**: Show when using semantic search

RESPONSE GUIDELINES:
• If data found: Provide comprehensive details
• If no data: Clearly state "I couldn't find any information about [query]"
• For follow-up questions: Reference conversation context naturally
• Be concise: Max 500 words
• Professional but conversational tone
• **Number of results**: ${requestedCount ? `Show EXACTLY ${requestedCount} results as requested` : 'Show all available results (up to 20)'}
• If user asks for specific number (e.g., "top 10"), respect that EXACTLY
• If search type is "candidates_broad_search" or "top_candidates_for_skill": Explain that results match the search term in skills, experience, or resume
• If search type is "candidates_by_job_title" or "jobs_by_title": Explain these are role/title matches

CRITICAL:
• Never make up information
• Never claim capabilities you don't have
• If uncertain, say so
• Always be helpful and accurate
• ${requestedCount ? `MUST show ${requestedCount} results - count them before responding!` : 'Show all relevant results'}
• When showing search results, ALWAYS include the actual data found, don't just say you found it`;
  }

  // ============================================
  // MAIN CHAT MESSAGE HANDLER
  // ============================================

  
static async sendMessage(
  message: string,
  jobId: string,
  conversationHistory: Array<{role: 'user' | 'assistant', content: string}> = []
): Promise<ChatResponse> { // <-- CHANGE THIS LINE
    try {
      const lowerMessage = message.toLowerCase().trim();

      // Classify query  type
      const classification = this.classifyQuery(message);
      console.log('🏷️ Query classification:', classification);

      // Extract requested count if any
      const requestedCount = this.extractRequestedCount(message);
      if (requestedCount) {
        console.log(`🔢 User requested ${requestedCount} results`);
      }

      // Get stats
      const stats = await this.getStats();

      // Handle greetings quickly
      if (classification.type === 'greeting') {
        const responses = [
          `Hello! 👋 I'm your AI recruitment assistant. I have access to ${stats.totalCandidates} candidates and ${stats.totalJobs} jobs. How can I help you today?`,
          `Hi there! 👋 Ready to help you with recruitment tasks. We have ${stats.totalCandidates} candidates in the database. What would you like to know?`,
          `Hey! 👋 I'm here to assist with your recruitment needs. Ask me about candidates, jobs, clients, or analytics!`
        ];
        return responses[Math.floor(Math.random() * responses.length)];
      }

      // ADD THIS ENTIRE NEW BLOCK
      if (classification.type === 'unclear') {
        const searchTerm = message.trim();
        // Capitalize the first letter for better display
        const displayTerm = searchTerm.charAt(0).toUpperCase() + searchTerm.slice(1);

        const suggestions = [
          `Candidates with specific skills or experience in ${displayTerm}`,
          `Job openings related to ${displayTerm}`,
          `Analytics or reports on ${displayTerm} positions`
        ];

        return {
          text: `I'd be happy to help! Could you please clarify what you're looking for regarding "${displayTerm}"? For example, are you interested in:`,
          suggestions: suggestions
        };
      }

      // Check for JD (long text input)
      const isJD = message.length > 250 && (
        lowerMessage.includes('responsibilities') || 
        lowerMessage.includes('requirements') || 
        (lowerMessage.includes('skills') && lowerMessage.includes('experience'))
      );
      
      if (isJD) {
        console.log('📄 JD detected');
        return this.getRankedCandidatesFromJD(message);
      }

      // Check for analytics
      const isAnalytics = lowerMessage.includes('report') || 
                          lowerMessage.includes('analytics') || 
                          lowerMessage.includes('distribution') ||
                          lowerMessage.includes('pipeline overview');
      
      if (isAnalytics) {
        console.log('📊 Analytics query');
        return this.getAnalyticsReport(lowerMessage);
      }

      // Similar candidates query
      if (lowerMessage.includes('similar candidates to') || lowerMessage.includes('candidates like')) {
        const candidateName = this.extractNameFromQuery(message);
        
        if (candidateName) {
          const { data: candidate } = await supabase
            .from('hr_job_candidates')
            .select('id, name')
            .ilike('name', `%${candidateName}%`)
            .single();
          
          if (candidate) {
            try {
              const similar = await EmbeddingService.findSimilarCandidates(candidate.id, 5);
              
              if (similar.length > 0) {
                return this.formatSimilarCandidatesResponse(candidate.name, similar);
              }
            } catch (error) {
              console.warn('⚠️ Semantic similarity search unavailable');
            }
          }
        }
      }

      // Cache check for recruitment queries
      if (classification.type === 'recruitment') {
        const cacheKey = lowerMessage;
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL && conversationHistory.length === 0) {
          console.log('✅ Cache hit');
          return cached.response;
        }
      }

      // Perform search for recruitment queries
      let searchResults = null;
      if (classification.type === 'recruitment') {
        console.log('🔍 Query:', message);
        searchResults = await this.smartSearch(message, conversationHistory, requestedCount);
        console.log('📊 Search Type:', searchResults?.type);
      }

      // Generate response using OpenAI
      const systemPrompt = this.generateSystemPrompt(
        classification.type,
        stats,
        searchResults,
        conversationHistory,
        requestedCount
      );

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: message }
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}` 
        },
        body: JSON.stringify({ 
          model: 'gpt-4o-mini', 
          max_tokens: 1200,
          temperature: 0.6,
          messages 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI: ${errorData.error?.message}`);
      }

      const aiResponse = await response.json();
      const answer = aiResponse.choices[0].message.content;

      // Cache recruitment responses
      if (classification.type === 'recruitment' && conversationHistory.length === 0) {
        responseCache.set(lowerMessage, { response: answer, timestamp: Date.now() });
      }

      const cost = ((aiResponse.usage?.total_tokens || 0) / 1000000) * 0.15;
      console.log(`💰 Tokens: ${aiResponse.usage?.total_tokens || 0} | Cost: $${cost.toFixed(6)}`);

      return answer;
    } catch (error: any) {
      console.error('❌ Error:', error);
      throw error;
    }
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  static async getAllJobs() {
    try {
      const { data, error } = await supabase
        .from('hr_jobs')
        .select('*')
        .order('posted_date', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error:', error);
      return [];
    }
  }

  static clearCache() {
    responseCache.clear();
    console.log('🗑️ Cache cleared');
  }
}