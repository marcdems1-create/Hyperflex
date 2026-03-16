require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase
    .from('markets')
    .select('id, question, creator_id, tenant_slug, created_at, resolved')
    .order('created_at', { ascending: false });

  if (error) { console.error('Error:', error.message); return; }

  const groups = {};
  (data || []).forEach(m => {
    const slug = m.tenant_slug || m.creator_id || 'global';
    const key = slug + '|||' + m.question.toLowerCase().trim().slice(0, 80);
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  const dupes = Object.entries(groups).filter(([, v]) => v.length > 1);
  console.log('Total markets:', (data || []).length);
  console.log('Duplicate groups found:', dupes.length);

  if (dupes.length === 0) {
    console.log('No duplicates — all clean.');
    return;
  }

  // Show dupes grouped by creator slug
  const bySlug = {};
  dupes.forEach(([key, markets]) => {
    const slug = key.split('|||')[0];
    if (!bySlug[slug]) bySlug[slug] = [];
    bySlug[slug].push({ question: markets[0].question.slice(0, 80), count: markets.length, ids: markets.map(m => m.id) });
  });

  Object.entries(bySlug).forEach(([slug, items]) => {
    console.log('\n[' + slug + '] — ' + items.length + ' duplicate group(s)');
    items.forEach(item => {
      console.log('  x' + item.count + ' "' + item.question + '"');
      console.log('  IDs to DELETE (keep first): ' + item.ids.slice(1).join(', '));
    });
  });

  // Collect all IDs to delete (keep the newest, delete the rest)
  const toDelete = dupes.flatMap(([, markets]) => markets.slice(1).map(m => m.id));
  console.log('\nTotal duplicate records to remove:', toDelete.length);
  console.log('IDs:', toDelete.join(', '));
}

check().catch(console.error);
