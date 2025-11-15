import { supabaseChatbot as supabase } from '../lib/supabaseChatbot';

// Response cache
const responseCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export class ChatService {
  // Get comprehensive statistics
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

  // Helper: Parse experience
  static parseExperience(experienceText: string): number {
    if (!experienceText) return 0;
    const yearMatch = experienceText.match(/(\d+)\s*year/i);
    const monthMatch = experienceText.match(/(\d+)\s*month/i);
    const years = yearMatch ? parseInt(yearMatch[1]) : 0;
    const months = monthMatch ? parseInt(monthMatch[1]) : 0;
    return years + (months / 12);
  }

  // Helper: Extract various patterns
  static extractEmail(query: string): string | null {
    const match = query.match(/[\w.-]+@[\w.-]+\.\w+/);
    return match ? match[0] : null;
  }

  static extractPhone(query: string): string | null {
    const match = query.match(/(\+91)?[\s-]?([6-9]\d{9})/);
    return match ? match[2] : null;
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
    const skillKeywords = ['javascript', 'typescript', 'react', 'node', 'python', 'java', 'dialogflow', 'playwright', 'aws', 'azure', 'gcp', 'servicenow'];
    const lowerQuery = query.toLowerCase();
    return skillKeywords.find(skill => lowerQuery.includes(skill)) || null;
  }

  // 🔥 COMPREHENSIVE SMART SEARCH - Searches ALL tables and fields
  static async smartSearch(query: string, conversationHistory: Array<{role: string, content: string}> = []) {
    const lowerQuery = query.toLowerCase();

    try {
      // 1. EMAIL SEARCH
      const email = this.extractEmail(query);
      if (email) {
        console.log('🔍 Email search:', email);
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .eq('email', email);
        
        if (data && data.length > 0) {
          const jobIds = data.map(c => c.job_id).filter(Boolean);
          const { data: jobs } = await supabase.from('hr_jobs').select('*').in('id', jobIds);
          const jobMap = new Map(jobs?.map(j => [j.id, j]) || []);
          return {
            type: 'candidate_full_details',
            data: data.map(c => ({ ...c, job_details: jobMap.get(c.job_id) })),
          };
        }
      }

      // 2. PHONE SEARCH
      const phone = this.extractPhone(query);
      if (phone) {
        console.log('🔍 Phone search:', phone);
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .ilike('phone', `%${phone}%`);
        if (data && data.length > 0) return { type: 'candidate_full_details', data };
      }

      // 3. EXPERIENCE FILTER
      const experienceFilter = this.extractExperience(query);
      if (experienceFilter) {
        console.log('🔍 Experience filter:', experienceFilter);
        const { data: allCandidates } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .not('experience', 'is', null);
        
        const filtered = allCandidates
          ?.map(c => ({ ...c, experienceYears: this.parseExperience(c.experience || '') }))
          .filter(c => experienceFilter.operator === 'gt' ? c.experienceYears > experienceFilter.years : c.experienceYears < experienceFilter.years)
          .slice(0, 30) || [];
        
        if (filtered.length > 0) return { type: 'candidates_by_experience', data: filtered };
      }

      // 4. SCORE FILTER
      const scoreFilter = this.extractScore(query);
      if (scoreFilter) {
        console.log('🔍 Score filter:', scoreFilter);
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .not('overall_score', 'is', null)
          .filter('overall_score', scoreFilter.operator === 'gt' ? 'gte' : 'lte', scoreFilter.score)
          .order('overall_score', { ascending: false })
          .limit(20);
        if (data && data.length > 0) return { type: 'candidates_by_score', data };
      }

      // 5. SALARY FILTER
      const salaryFilter = this.extractSalary(query);
      if (salaryFilter) {
        console.log('🔍 Salary filter:', salaryFilter);
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .not('expected_salary', 'is', null)
          .filter('expected_salary', salaryFilter.operator === 'gt' ? 'gte' : 'lte', salaryFilter.amount)
          .limit(20);
        if (data && data.length > 0) return { type: 'candidates_by_salary', data };
      }

      // 6. SKILL SEARCH
      const skill = this.extractSkill(query);
      if (skill) {
        console.log('🔍 Skill search:', skill);
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .ilike('skills', `%${skill}%`)
          .limit(20);
        if (data && data.length > 0) return { type: 'candidates_by_skill', data };
      }

      // 7. DATE QUERIES (applied date, posted date, etc.)
      if (lowerQuery.includes('applied') || lowerQuery.includes('date')) {
        console.log('🔍 Date query detected');
        const lastCandidate = conversationHistory
          .reverse()
          .find(msg => msg.role === 'assistant' && (msg.content.includes('**') || msg.content.includes('Email')));
        if (lastCandidate) {
          const nameMatch = lastCandidate.content.match(/\*\*(.*?)\*\*/);
          if (nameMatch) {
            const name = nameMatch[1];
            console.log('🔍 Found candidate from history:', name);
            const { data } = await supabase.from('hr_job_candidates').select('*').ilike('name', `%${name}%`).limit(1);
            if (data && data.length > 0) return { type: 'candidate_full_details', data };
          }
        }
        const { data } = await supabase.from('hr_job_candidates').select('name, applied_date, email, status').order('applied_date', { ascending: false }).limit(10);
        if (data && data.length > 0) return { type: 'recent_applications', data };
      }

      // ✨ MODIFICATION 1: ENHANCED STATUS QUERIES
      const statusKeywords = {
        screening: ['screening', 'reviewing', 'in review'],
        selected: ['selected', 'hired', 'accepted', 'passed', 'succeeded'],
        rejected: ['rejected', 'declined', 'failed', 'not selected'],
        interview: ['interview', 'interviewing', 'scheduled']
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
        const statusValue = matchedStatusKey === 'screening' ? 'Screening' : matchedStatusKey;
        const column = matchedStatusKey === 'screening' ? 'status' : 'interview_result';
        const { data } = await supabase
          .from('hr_job_candidates')
          .select('*')
          .eq(column, statusValue)
          .limit(20);
        if (data && data.length > 0) return { type: 'candidates_by_status', data };
      }

      // 9. LOCATION SEARCH
      const locations = ['bangalore', 'bengaluru', 'chennai', 'hyderabad', 'pune', 'mumbai', 'delhi'];
      const matchedLocation = locations.find(loc => lowerQuery.includes(loc));
      if (matchedLocation) {
        console.log('🔍 Location search:', matchedLocation);
        const { data } = await supabase.from('hr_job_candidates').select('*').ilike('location', `%${matchedLocation}%`).limit(20);
        if (data && data.length > 0) return { type: 'candidates_by_location', data };
      }

      // 10. CLIENT SEARCH
      if (lowerQuery.includes('client')) {
        console.log('🔍 Client search');
        const { data: clients } = await supabase.from('hr_clients').select('*').limit(20);
        const { data: contacts } = await supabase.from('hr_client_contacts').select('*').limit(20);
        if (clients && clients.length > 0) return { type: 'clients_and_contacts', data: { clients, contacts } };
      }

      // 11. JOB SEARCH
      const jobKeywords = ['job', 'position', 'opening', 'vacancy', 'role'];
      if (jobKeywords.some(kw => lowerQuery.includes(kw)) && !lowerQuery.includes('how many')) {
        console.log('🔍 Job search');
        const { data } = await supabase.from('hr_jobs').select('*').limit(20);
        if (data && data.length > 0) return { type: 'jobs', data };
      }

      // 12. STATUS TYPES
      if (lowerQuery.includes('status') && (lowerQuery.includes('type') || lowerQuery.includes('list') || lowerQuery.includes('available'))) {
        console.log('🔍 Status types');
        const { data } = await supabase.from('job_statuses').select('*').order('display_order');
        if (data && data.length > 0) return { type: 'job_statuses', data };
      }

      // 13. COMPREHENSIVE KEYWORD SEARCH (Smart Fallback)
      console.log('🔍 No specific pattern found. Performing comprehensive keyword search...');
      const keywords = lowerQuery.split(' ').filter(w => w.length > 3 && !['can','get','details','of','about','show','find','the', 'list', 'all', 'are', 'who'].includes(w));
      if (keywords.length > 0) {
        const searchPattern = keywords.map(kw => `name.ilike.%${kw}%,skills.ilike.%${kw}%,location.ilike.%${kw}%`).join(',');
        const [candidateRes, jobRes, clientRes] = await Promise.all([
            supabase.from('hr_job_candidates').select('*').or(searchPattern).limit(10),
            supabase.from('hr_jobs').select('*').or(`job_title.ilike.%${keywords.join('%')}%`).limit(5),
            supabase.from('hr_clients').select('*').or(`client_name.ilike.%${keywords.join('%')}%`).limit(5)
        ]);
        const combinedData = { candidates: candidateRes.data, jobs: jobRes.data, clients: clientRes.data };
        if ((candidateRes.data && candidateRes.data.length > 0) || (jobRes.data && jobRes.data.length > 0) || (clientRes.data && clientRes.data.length > 0)) {
            console.log(`📊 Found ${candidateRes.data?.length || 0} candidates, ${jobRes.data?.length || 0} jobs, ${clientRes.data?.length || 0} clients.`);
            return { type: 'combined_keyword_search', data: combinedData };
        }
      }

      return { type: 'no_results', data: null };

    } catch (error) {
      console.error('Smart search error:', error);
      return { type: 'error', data: null };
    }
  }

  // ✨ MODIFICATION 2: NEW FEATURE FUNCTION for JD-to-Candidate Matching
  static async getRankedCandidatesFromJD(jobDescription: string): Promise<string> {
    try {
        console.log('🤖 Starting JD-to-Candidate matching process...');
        // Step 1: Use AI to extract key criteria from the JD
        const extractionPrompt = `
            Analyze the following job description and extract the key recruitment criteria.
            Focus on essential skills, years of experience required, and location.
            Return the result ONLY as a valid JSON object with the following structure:
            { "skills": ["skill1", "skill2", ...], "experience": 5, "location": "City" }
            
            Job Description:
            ---
            ${jobDescription}
        `;
        
        let apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: extractionPrompt }],
                temperature: 0.1,
            }),
        });

        if (!apiResponse.ok) throw new Error('AI criteria extraction failed');
        let aiJson = await apiResponse.json();
        const criteria = JSON.parse(aiJson.choices[0].message.content);
        console.log('✅ Criteria extracted:', criteria);

        // Step 2: Find a pool of potential candidates from the database
        const { data: candidates } = await supabase
            .from('hr_job_candidates')
            .select('name, email, phone, experience, skills, overall_score, location, status')
            .ilike('skills', `%${criteria.skills[0]}%`) // Start with at least the first skill
            .limit(30);

        if (!candidates || candidates.length === 0) {
            return "I've analyzed the job description, but I couldn't find any potential candidates in the database matching the initial criteria.";
        }
        console.log(`✅ Found ${candidates.length} potential candidates.`);

        // Step 3: Use AI to rank the candidates
        const rankingPrompt = `
            You are an expert HR recruitment specialist. Your task is to analyze the provided Job Description and rank the list of candidates based on their suitability.
            
            Provide a clear, concise ranking of the top 5 candidates.
            For each of the top 5, provide:
            - A suitability score out of 100.
            - A 1-2 sentence justification for your ranking, highlighting their key strengths and weaknesses against the JD.

            Format the entire output in Markdown.
            
            ---
            JOB DESCRIPTION:
            ${jobDescription}
            ---
            CANDIDATE PROFILES (JSON):
            ${JSON.stringify(candidates, null, 2)}
        `;

        apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: rankingPrompt }],
                temperature: 0.5,
                max_tokens: 1000,
            }),
        });

        if (!apiResponse.ok) throw new Error('AI ranking failed');
        aiJson = await apiResponse.json();
        const ranking = aiJson.choices[0].message.content;
        console.log('✅ Ranking complete.');
        
        return "I have analyzed the job description you provided. Here are the top candidates from our database that I believe are the best fit:\n\n" + ranking;

    } catch (error: any) {
        console.error('❌ Error in JD matching:', error);
        return `I encountered an error while analyzing the job description: ${error.message}`;
    }
  }

  // 🔥 MAIN CHAT WITH CONVERSATION HISTORY (MODIFIED for JD detection)
  static async sendMessage(
    message: string, 
    jobId: string,
    conversationHistory: Array<{role: 'user' | 'assistant', content: string}> = []
  ): Promise<string> {
    try {
      // ✨ MODIFICATION 2: JD Detection Logic
      const isJD = message.length > 250 && (message.toLowerCase().includes('responsibilities') || message.toLowerCase().includes('skills') || message.toLowerCase().includes('experience'));
      if (isJD) {
        console.log('JD detected. Starting candidate matching...');
        return this.getRankedCandidatesFromJD(message);
      }

      const cacheKey = message.toLowerCase().trim();
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('✅ Cache hit!');
        return cached.response;
      }

      console.log('🔍 Query:', message);
      console.log('📜 History length:', conversationHistory.length);

      const stats = await this.getStats();
      const searchResults = await this.smartSearch(message, conversationHistory);

      console.log('📊 Results Type:', searchResults.type);

      let context = `GENERAL DATABASE STATISTICS:
- Total Jobs: ${stats.totalJobs} | Total Candidates: ${stats.totalCandidates} | Total Clients: ${stats.totalClients}
- Average Candidate Score: ${stats.averageCandidateScore}/100
- Candidate Pipeline: ${stats.screening} in Screening, ${stats.selected} Selected, ${stats.rejected} Rejected
`;

      if (searchResults.data && Object.values(searchResults.data).some(d => Array.isArray(d) ? d.length > 0 : d)) {
        context += `\nSEARCH RESULTS (Query: "${message}") (Search Type: ${searchResults.type}):
${JSON.stringify(searchResults.data, null, 2)}`;
      } else {
        context += `\nNOTE: My initial targeted database search for the query "${message}" did not return any specific results. I will answer based on general knowledge and conversation history.`
      }

      const conversationContext = conversationHistory.slice(-6).map(msg => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
      ).join('\n');
      
      const systemPrompt = `You are hrumbles.ai, a world-class AI recruitment assistant. Your purpose is to provide precise, comprehensive, and helpful answers based on the data provided.

CONVERSATION HISTORY:
${conversationContext}

CURRENT DATABASE CONTEXT FOR THE USER'S QUERY:
${context}

**YOUR TASK:**
Analyze the user's question ("${message}") and answer it using the "SEARCH RESULTS" from the database context. If the search results are empty, use the "GENERAL DATABASE STATISTICS" or state that you couldn't find specific information.

**RESPONSE RULES (Strictly Follow):**
1.  **Synthesize, Don't Just List:** Do not just dump the JSON data. Interpret it. For example, if you find a candidate and a job that match, explain how they are related. Connect the dots for the user.
2.  **Prioritize Search Results:** Your primary source of truth is the "SEARCH RESULTS" JSON block. Rely on it heavily.
3.  **Comprehensive Answers:** If candidate data is found, provide a full summary: name, email, phone, experience, score, status, salary, location, and applied date.
4.  **Acknowledge No Results:** If the search returned no data for a specific query, clearly state that. For example, "I couldn't find any candidates with the name 'XYZ', but here are some with similar skills."
5.  **Be Conversational & Professional:** Maintain a helpful and expert tone.
6.  **Formatting:**
    - Use **bold** for names and key terms.
    - Use bullet points for lists.
    - Format Salaries as ₹X.XXL, Scores as X/100, and Dates as DD-MMM-YYYY.
7.  **Be Concise:** Keep responses under 400 words. If there are many results, summarize and show the top 5-10.

Now, provide a direct and helpful answer to the user's question.`;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: message },
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY!}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 800,
          temperature: 0.5,
          messages,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI error: ${errorData.error?.message}`);
      }

      const aiResponse = await response.json();
      const answer = aiResponse.choices[0].message.content;

      responseCache.set(cacheKey, { response: answer, timestamp: Date.now() });
      console.log(`📊 Tokens: ${aiResponse.usage.total_tokens} | Cost: $${((aiResponse.usage.total_tokens / 1000000) * 0.15).toFixed(6)}`);

      return answer;
    } catch (error: any) {
      console.error('❌ Error:', error);
      throw error;
    }
  }

  static async getAllJobs() {
    try {
      const { data, error } = await supabase.from('hr_jobs').select('*').order('posted_date', { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching jobs:', error);
      return [];
    }
  }

  static clearCache() {
    responseCache.clear();
    console.log('🗑️ Cache cleared');
  }
}