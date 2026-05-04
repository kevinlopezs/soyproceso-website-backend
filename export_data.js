const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: 'postgresql://postgres.xqjcexxltlixiddjbhfh:Kx35WCQeUMuboPqc@aws-0-us-west-2.pooler.supabase.com:6543/postgres'
});

const tables = [
  'blog_categories',
  'profiles',
  'blog_posts',
  'blog_post_categories',
  'uploaded_files',
  'experience_campaigns',
  'experience_submissions',
  'wa_chats',
  'wa_messages',
  'autodiagnostico_submissions',
  'email_unsubscriptions'
];

async function run() {
  await client.connect();
  let sql = '-- Seed data exported from production via pg pooler\n\n';
  
  for (const table of tables) {
    console.log(`Exporting ${table}...`);
    try {
      const res = await client.query(`SELECT * FROM public.${table}`);
      const data = res.rows;
      if (!data || data.length === 0) continue;
      
      const keys = Object.keys(data[0]);
      sql += `-- Data for ${table}\n`;
      
      for (const row of data) {
        const values = keys.map(k => {
          let val = row[k];
          if (val === null) return 'NULL';
          if (typeof val === 'string') return "'" + val.replace(/'/g, "''") + "'";
          if (typeof val === 'object') {
             if (val instanceof Date) return "'" + val.toISOString() + "'";
             return "'" + JSON.stringify(val).replace(/'/g, "''") + "'";
          }
          return val;
        });
        sql += `INSERT INTO public.${table} ("${keys.join('", "')}") VALUES (${values.join(', ')});\n`;
      }
      sql += '\n';
    } catch(err) {
      console.error(`Error exporting ${table}:`, err.message);
    }
  }
  
  fs.writeFileSync('supabase-staging/supabase/seed.sql', sql);
  console.log('Export complete.');
  await client.end();
}

run();
