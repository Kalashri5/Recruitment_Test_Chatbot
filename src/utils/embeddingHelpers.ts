import { EmbeddingService } from '../services/embeddingService';
import { ChatService } from '../services/chatService';
import { supabaseChatbot as supabase } from '../lib/supabaseChatbot';

// Export services to window
(window as any).EmbeddingService = EmbeddingService;
(window as any).ChatService = ChatService;

// ============================================
// EMBEDDING FUNCTIONS (Standalone - no external imports)
// ============================================

export async function embedFirst5() {
  console.log('🧪 Testing with 5 candidates...\n');
  
  try {
    const { data: candidates } = await supabase
      .from('hr_job_candidates')
      .select('id, name')
      .not('resume_text', 'is', null)
      .limit(5);
    
    if (!candidates || candidates.length === 0) {
      console.log('❌ No candidates found');
      return { total: 0, success: 0, failed: 0, skipped: 0, totalCost: 0 };
    }
    
    console.log(`📊 Found ${candidates.length} candidates:`);
    candidates.forEach((c, i) => console.log(`   ${i + 1}. ${c.name}`));
    console.log('');
    
    const candidateIds = candidates.map(c => c.id);
    const result = await EmbeddingService.embedAllCandidates(candidateIds);
    
    console.log('\n✅ Complete!');
    console.log(`   Success: ${result.success}/${result.total}`);
    console.log(`   Cost: $${result.totalCost.toFixed(6)}`);
    
    return result;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return { total: 0, success: 0, failed: 0, skipped: 0, totalCost: 0 };
  }
}

export async function embedAll() {
  try {
    const { count } = await supabase
      .from('hr_job_candidates')
      .select('*', { count: 'exact', head: true });
    
    if (!count) {
      console.log('❌ No candidates found');
      return;
    }
    
    const cost = (count * 2000 / 1000000) * 0.02;
    console.log(`📊 ${count} candidates found`);
    console.log(`💰 Estimated cost: $${cost.toFixed(4)}`);
    
    if (!window.confirm(`Embed ${count} candidates for ~$${cost.toFixed(4)}?`)) {
      console.log('❌ Cancelled');
      return;
    }
    
    console.log('🚀 Starting...\n');
    const result = await EmbeddingService.embedAllCandidates();
    
    console.log('\n🎉 Done!');
    console.log(`   Success: ${result.success}/${result.total}`);
    console.log(`   Cost: $${result.totalCost.toFixed(4)}`);
    
    return result;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

export async function checkStats() {
  try {
    const stats = await EmbeddingService.getStats();
    if (!stats) {
      console.log('⚠️ No stats yet. Run: embedFirst5()');
      return null;
    }
    console.log('📊 Stats:');
    console.table({
      'Candidates': stats.total_candidates_embedded || 0,
      'Jobs': stats.total_jobs_embedded || 0,
      'Tokens': (stats.total_tokens_used || 0).toLocaleString(),
      'Cost': `$${(stats.total_cost_usd || 0).toFixed(4)}`,
      'Last': stats.last_generated ? new Date(stats.last_generated).toLocaleString() : 'Never'
    });
    return stats;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

export async function testSearch(query: string) {
  console.log(`🔍 Searching: "${query}"\n`);
  try {
    const results = await EmbeddingService.searchSimilarCandidates(query, 5, 0.7);
    if (!results || results.length === 0) {
      console.log('⚠️ No results. Run: embedFirst5()');
      return [];
    }
    console.log(`✅ Found ${results.length}:\n`);
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.name} (${r.similarity_score}% match)`);
      console.log(`   ${r.email}`);
      console.log(`   Skills: ${(r.skills || '').substring(0, 60)}...`);
      console.log('');
    });
    return results;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return [];
  }
}

export async function testChatbot(query: string) {
  console.log(`💬 Query: "${query}"\n`);
  try {
    const response = await ChatService.sendMessage(query, 'test', []);
    console.log('✅ Response:\n');
    console.log('─'.repeat(50));
    console.log(response);
    console.log('─'.repeat(50) + '\n');
    return response;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

export async function checkDatabase() {
  console.log('🏥 Checking database...\n');
  try {
    const [candidates, jobs, clients, embeddings] = await Promise.all([
      supabase.from('hr_job_candidates').select('count', { count: 'exact', head: true }),
      supabase.from('hr_jobs').select('count', { count: 'exact', head: true }),
      supabase.from('hr_clients').select('count', { count: 'exact', head: true }),
      supabase.from('resume_embeddings').select('count', { count: 'exact', head: true }),
    ]);
    
    console.log('✅ Database:');
    console.table({
      'Candidates': candidates.count || 0,
      'Jobs': jobs.count || 0,
      'Clients': clients.count || 0,
      'Embeddings': embeddings.count || 0
    });
    
    if ((embeddings.count || 0) === 0) {
      console.log('\n💡 No embeddings yet. Run: embedFirst5()');
    }
    
    return { candidates: candidates.count, jobs: jobs.count, clients: clients.count, embeddings: embeddings.count };
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

// Export to window
(window as any).embedFirst5 = embedFirst5;
(window as any).embedAll = embedAll;
(window as any).checkStats = checkStats;
(window as any).testSearch = testSearch;
(window as any).testChatbot = testChatbot;
(window as any).checkDatabase = checkDatabase;

// Show help
console.log('\n🤖 ══════════════════════════════════════════');
console.log('   HRUMBLES.AI - Helper Functions');
console.log('══════════════════════════════════════════\n');
console.log('📝 Commands:\n');
console.log('  embedFirst5()         - Test with 5');
console.log('  embedAll()            - Embed all');
console.log('  checkStats()          - View stats');
console.log('  testSearch("query")   - Test search');
console.log('  testChatbot("query")  - Test chat');
console.log('  checkDatabase()       - Check DB\n');
console.log('�� Quick start:\n');
console.log('  1. checkDatabase()');
console.log('  2. embedFirst5()');
console.log('  3. testChatbot("hi")\n');
console.log('══════════════════════════════════════════\n');
