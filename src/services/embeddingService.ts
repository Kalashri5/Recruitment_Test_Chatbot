import { supabaseChatbot as supabase } from '../lib/supabaseChatbot';

interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  tokensUsed?: number;
  cost?: number;
  error?: string;
}

interface CandidateEmbedding {
  candidateId: string;
  embedding: number[];
  chunkText: string;
  metadata: any;
}

export class EmbeddingService {
  private static readonly EMBEDDING_MODEL = 'text-embedding-3-small'; // $0.02 per 1M tokens
  private static readonly EMBEDDING_DIMENSIONS = 1536;
  private static readonly MAX_CHUNK_SIZE = 8000; // tokens
  private static readonly COST_PER_1M_TOKENS = 0.02;

  // ============================================
  // CORE EMBEDDING FUNCTIONS
  // ============================================

  /**
   * Generate embedding for text using OpenAI
   */
  static async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      const cleanText = text.replace(/\s+/g, ' ').trim().substring(0, 8000);
      
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: this.EMBEDDING_MODEL,
          input: cleanText,
          dimensions: this.EMBEDDING_DIMENSIONS
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${errorData.error?.message}`);
      }

      const data = await response.json();
      const tokensUsed = data.usage.total_tokens;
      const cost = (tokensUsed / 1000000) * this.COST_PER_1M_TOKENS;

      console.log(`✅ Embedding generated: ${tokensUsed} tokens, $${cost.toFixed(6)}`);

      return {
        success: true,
        embedding: data.data[0].embedding,
        tokensUsed,
        cost
      };
    } catch (error: any) {
      console.error('❌ Embedding generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate embeddings in batch (with rate limiting)
   */
  static async generateBatchEmbeddings(
    texts: string[],
    delayMs: number = 100
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    
    for (let i = 0; i < texts.length; i++) {
      console.log(`📊 Processing ${i + 1}/${texts.length}...`);
      const result = await this.generateEmbedding(texts[i]);
      results.push(result);
      
      // Rate limiting
      if (i < texts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return results;
  }

  // ============================================
  // CANDIDATE EMBEDDING FUNCTIONS
  // ============================================

  /**
   * Prepare candidate text for embedding
   */
  static prepareCandidateText(candidate: any): string {
    const parts = [
      `Name: ${candidate.name || 'Unknown'}`,
      candidate.email ? `Email: ${candidate.email}` : '',
      candidate.phone ? `Phone: ${candidate.phone}` : '',
      candidate.experience ? `Experience: ${candidate.experience}` : '',
      candidate.skills ? `Skills: ${candidate.skills}` : '',
      candidate.location ? `Location: ${candidate.location}` : '',
      candidate.resume_text ? `Resume: ${candidate.resume_text.substring(0, 4000)}` : '',
      candidate.summary ? `Summary: ${candidate.summary}` : ''
    ];

    return parts.filter(p => p).join('\n\n');
  }

  /**
   * Generate embedding for a single candidate
   */
  static async embedCandidate(candidateId: string): Promise<boolean> {
    try {
      // Fetch candidate data
      const { data: candidate, error: fetchError } = await supabase
        .from('hr_job_candidates')
        .select('*')
        .eq('id', candidateId)
        .single();

      if (fetchError || !candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      // Prepare text
      const textToEmbed = this.prepareCandidateText(candidate);
      
      // Generate embedding
      const result = await this.generateEmbedding(textToEmbed);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      // Store embedding
      const { error: insertError } = await supabase
        .from('resume_embeddings')
        .upsert({
          candidate_id: candidateId,
          embedding_type: 'resume',
          chunk_text: textToEmbed.substring(0, 1000),
          embedding: JSON.stringify(result.embedding),
          metadata: {
            name: candidate.name,
            skills: candidate.skills,
            experience: candidate.experience,
            location: candidate.location,
            overall_score: candidate.overall_score
          }
        }, {
          onConflict: 'candidate_id'
        });

      if (insertError) throw insertError;

      // Log generation
      await supabase.from('embedding_generation_log').insert({
        entity_type: 'candidate',
        entity_id: candidateId,
        status: 'completed',
        tokens_used: result.tokensUsed,
        cost_usd: result.cost
      });

      console.log(`✅ Embedded candidate: ${candidate.name} (${candidateId})`);
      return true;

    } catch (error: any) {
      console.error(`❌ Failed to embed candidate ${candidateId}:`, error);
      
      await supabase.from('embedding_generation_log').insert({
        entity_type: 'candidate',
        entity_id: candidateId,
        status: 'failed',
        error_message: error.message
      });
      
      return false;
    }
  }

  /**
   * Embed all candidates (or specific ones)
   */
  static async embedAllCandidates(candidateIds?: string[]): Promise<{
    total: number;
    success: number;
    failed: number;
    totalCost: number;
  }> {
    console.log('🚀 Starting candidate embedding process...');
    
    let query = supabase
      .from('hr_job_candidates')
      .select('id, name')
      .not('resume_text', 'is', null);

    if (candidateIds && candidateIds.length > 0) {
      query = query.in('id', candidateIds);
    }

    const { data: candidates, error } = await query;

    if (error || !candidates) {
      console.error('❌ Failed to fetch candidates:', error);
      return { total: 0, success: 0, failed: 0, totalCost: 0 };
    }

    console.log(`📊 Found ${candidates.length} candidates to embed`);

    let successCount = 0;
    let failedCount = 0;
    let totalCost = 0;

    for (let i = 0; i < candidates.length; i++) {
      console.log(`\n[${i + 1}/${candidates.length}] Processing: ${candidates[i].name}`);
      
      const success = await this.embedCandidate(candidates[i].id);
      
      if (success) {
        successCount++;
      } else {
        failedCount++;
      }

      // Rate limit: 100ms between requests
      if (i < candidates.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Get total cost
    const { data: stats } = await supabase.rpc('get_embedding_stats');
    totalCost = stats?.[0]?.total_cost_usd || 0;

    console.log('\n🎉 Embedding process completed!');
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failedCount}`);
    console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);

    return {
      total: candidates.length,
      success: successCount,
      failed: failedCount,
      totalCost
    };
  }

  // ============================================
  // SEMANTIC SEARCH FUNCTIONS
  // ============================================

  /**
   * Search candidates by semantic similarity
   */
  static async searchSimilarCandidates(
    query: string,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<any[]> {
    try {
      console.log(`🔍 Semantic search: "${query}"`);
      
      // Generate query embedding
      const result = await this.generateEmbedding(query);
      
      if (!result.success || !result.embedding) {
        throw new Error('Failed to generate query embedding');
      }

      // Search using similarity function
      const { data, error } = await supabase.rpc('match_candidates', {
        query_embedding: result.embedding,
        match_threshold: threshold,
        match_count: limit
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        console.log('⚠️ No similar candidates found');
        return [];
      }

      // Fetch full candidate details
      const candidateIds = data.map((d: any) => d.candidate_id);
      const { data: candidates } = await supabase
        .from('hr_job_candidates')
        .select('*')
        .in('id', candidateIds);

      // Merge similarity scores
      const results = candidates?.map(candidate => {
        const match = data.find((d: any) => d.candidate_id === candidate.id);
        return {
          ...candidate,
          similarity_score: match?.similarity ? (match.similarity * 100).toFixed(1) : 0
        };
      }) || [];

      console.log(`✅ Found ${results.length} similar candidates`);
      return results;

    } catch (error: any) {
      console.error('❌ Semantic search failed:', error);
      return [];
    }
  }

  /**
   * Find candidates similar to a given candidate
   */
  static async findSimilarCandidates(
    candidateId: string,
    limit: number = 5
  ): Promise<any[]> {
    try {
      // Get candidate's embedding
      const { data: embedding, error } = await supabase
        .from('resume_embeddings')
        .select('embedding')
        .eq('candidate_id', candidateId)
        .single();

      if (error || !embedding) {
        throw new Error('Candidate embedding not found');
      }

      // Search using the embedding
      const { data } = await supabase.rpc('match_candidates', {
        query_embedding: JSON.parse(embedding.embedding),
        match_threshold: 0.7,
        match_count: limit + 1 // +1 because it will include the query candidate
      });

      // Filter out the original candidate
      const similarIds = data
        ?.filter((d: any) => d.candidate_id !== candidateId)
        .map((d: any) => d.candidate_id)
        .slice(0, limit) || [];

      if (similarIds.length === 0) return [];

      // Fetch full details
      const { data: candidates } = await supabase
        .from('hr_job_candidates')
        .select('*')
        .in('id', similarIds);

      return candidates || [];

    } catch (error: any) {
      console.error('❌ Failed to find similar candidates:', error);
      return [];
    }
  }

  // ============================================
  // JOB DESCRIPTION MATCHING
  // ============================================

  /**
   * Embed a job description
   */
  static async embedJobDescription(jobId: string, jdText: string): Promise<boolean> {
    try {
      const result = await this.generateEmbedding(jdText);
      
      if (!result.success || !result.embedding) {
        throw new Error('Failed to generate JD embedding');
      }

      const { error } = await supabase
        .from('job_embeddings')
        .upsert({
          job_id: jobId,
          chunk_text: jdText.substring(0, 1000),
          embedding: JSON.stringify(result.embedding),
          metadata: { source: 'job_description' }
        }, {
          onConflict: 'job_id'
        });

      if (error) throw error;

      console.log(`✅ Embedded job: ${jobId}`);
      return true;

    } catch (error: any) {
      console.error(`❌ Failed to embed job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Find best candidates for a job description
   */
  static async matchCandidatesToJD(
    jdText: string,
    limit: number = 20,
    threshold: number = 0.75
  ): Promise<any[]> {
    try {
      // Generate JD embedding
      const result = await this.generateEmbedding(jdText);
      
      if (!result.success || !result.embedding) {
        throw new Error('Failed to generate JD embedding');
      }

      // Find matching candidates
      const { data, error } = await supabase.rpc('match_candidates_to_job', {
        job_embedding: result.embedding,
        match_threshold: threshold,
        match_count: limit
      });

      if (error) throw error;

      console.log(`✅ Found ${data?.length || 0} matching candidates`);
      return data || [];

    } catch (error: any) {
      console.error('❌ JD matching failed:', error);
      return [];
    }
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Get embedding statistics
   */
  static async getStats() {
    const { data } = await supabase.rpc('get_embedding_stats');
    return data?.[0] || null;
  }

  /**
   * Check if candidate is embedded
   */
  static async isCandidateEmbedded(candidateId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('resume_embeddings')
      .select('id')
      .eq('candidate_id', candidateId)
      .single();

    return !error && !!data;
  }

  /**
   * Delete candidate embedding
   */
  static async deleteCandidateEmbedding(candidateId: string): Promise<boolean> {
    const { error } = await supabase
      .from('resume_embeddings')
      .delete()
      .eq('candidate_id', candidateId);

    return !error;
  }

  /**
   * Re-embed a candidate (update existing)
   */
  static async reEmbedCandidate(candidateId: string): Promise<boolean> {
    await this.deleteCandidateEmbedding(candidateId);
    return await this.embedCandidate(candidateId);
  }
}
