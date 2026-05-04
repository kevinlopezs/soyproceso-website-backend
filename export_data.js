const fs = require('fs');

const PROJECT_REF = 'xqjcexxltlixiddjbhfh';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_SOYPROCESO_ACCESSTOKEN;

const tables = [
  { schema: 'auth', name: 'users' },
  { schema: 'public', name: 'blog_categories' },
  { schema: 'public', name: 'profiles' },
  { schema: 'public', name: 'blog_posts' },
  { schema: 'public', name: 'blog_post_categories' },
  { schema: 'public', name: 'uploaded_files' },
  { schema: 'public', name: 'experience_campaigns' },
  { schema: 'public', name: 'experience_submissions' },
  { schema: 'public', name: 'wa_chats' },
  { schema: 'public', name: 'wa_messages' },
  { schema: 'public', name: 'autodiagnostico_submissions' },
  { schema: 'public', name: 'email_unsubscriptions' }
];

async function run() {
  if (!TOKEN) {
    console.error("Missing SUPABASE_ACCESS_TOKEN in .env");
    process.exit(1);
  }

  let sql = '-- Seed data exported from production via Supabase Management API\n\n';
  
  for (const table of tables) {
    console.log(`Exporting ${table.schema}.${table.name}...`);
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: `SELECT * FROM ${table.schema}.${table.name}` })
      });
      
      if (!res.ok) {
        throw new Error(`API Error: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      if (!data || data.length === 0) continue;
      
      let keys = Object.keys(data[0]);
      if (table.schema === 'auth' && table.name === 'users') {
          keys = keys.filter(k => k !== 'confirmed_at' && k !== 'is_super_admin' && k !== 'is_anonymous');
      }
      
      sql += `-- Data for ${table.schema}.${table.name}\n`;
      
      for (const row of data) {
        const values = keys.map(k => {
          let val = row[k];
          if (val === null) return 'NULL';
          if (typeof val === 'string') return "'" + val.replace(/'/g, "''") + "'";
          if (typeof val === 'object') {
             if (val instanceof Date || (typeof val === 'string' && !isNaN(Date.parse(val)))) return "'" + new Date(val).toISOString() + "'";
             return "'" + JSON.stringify(val).replace(/'/g, "''") + "'";
          }
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return val;
        });
        
        let conflictClause = '';
        if (table.name === 'profiles' || table.name === 'users') {
          const updateSet = keys.filter(k => k !== 'id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
          if (updateSet) {
             conflictClause = ` ON CONFLICT ("id") DO UPDATE SET ${updateSet}`;
          } else {
             conflictClause = ` ON CONFLICT ("id") DO NOTHING`;
          }
        }
        sql += `INSERT INTO ${table.schema}.${table.name} ("${keys.join('", "')}") VALUES (${values.join(', ')})${conflictClause};\n`;
      }
      sql += '\n';
    } catch(err) {
      console.error(`Error exporting ${table}:`, err.message);
    }
  }
  
  fs.writeFileSync('supabase-staging/supabase/seed.sql', sql);
  console.log('Export complete.');
}

run();
