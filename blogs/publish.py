import json, os, re, subprocess

BLOG_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEDULE_FILE = os.path.join(BLOG_DIR, 'schedule.json')
BLOG_DATA_FILE = os.path.join(BLOG_DIR, '..', 'src', 'blogData.js')
REPO_DIR = os.path.dirname(BLOG_DIR)

with open(SCHEDULE_FILE) as f:
    schedule = json.load(f)

next_num = schedule['next']
if next_num > schedule['total']:
    print('All blogs have been published.')
    exit(0)

blog = next((b for b in schedule['blogs'] if b['num'] == next_num), None)
if not blog:
    print(f'Blog {next_num} not found in schedule.')
    exit(1)

# Update blogData.js to set the next blog's published field to true
with open(BLOG_DATA_FILE, 'r') as f:
    blog_data_content = f.read()

# The blogs are in order in the array (index 0 = blog 1, index 1 = blog 2, etc.)
# Find the Nth occurrence of "published: false" and change it to "published: true"
# Since blog 1 is already published, we need occurrence number (next_num - 1) counting from 0
# But we only count "published: false" entries, so it's the (next_num - 2 + 1)th = (next_num - 1)th
# Actually simpler: find all published fields and replace the one at index (next_num - 1)

# Split by entries and find the right one using slug from schedule
slug = blog['file'].replace('.md', '')
# Remove the number prefix (e.g., "01-what-is-cardchase" -> "what-is-cardchase")
slug = re.sub(r'^\d+-', '', slug)

# Find the blog entry block that contains this slug and flip published to true
pattern = r"(slug: '" + re.escape(slug) + r"'.*?published: )false"
replacement = r'\1true'
new_content, count = re.subn(pattern, replacement, blog_data_content, count=1, flags=re.DOTALL)

if count == 0:
    print(f'Could not find blog with slug "{slug}" in blogData.js or it is already published.')
    exit(1)

with open(BLOG_DATA_FILE, 'w') as f:
    f.write(new_content)

print(f'Updated blogData.js: set "{slug}" to published')

# Mark as published in schedule and advance to next
blog['status'] = 'published'
schedule['next'] = next_num + 1

with open(SCHEDULE_FILE, 'w') as f:
    json.dump(schedule, f, indent=2)

# Update sitemap with new blog post
SITEMAP_FILE = os.path.join(REPO_DIR, 'public', 'sitemap.xml')
if os.path.exists(SITEMAP_FILE):
    with open(SITEMAP_FILE, 'r') as f:
        sitemap = f.read()
    blog_url = f'https://pokemontrainercenter.com/blog/{slug}'
    if blog_url not in sitemap:
        new_entry = f'''  <url>
    <loc>{blog_url}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>'''
        sitemap = sitemap.replace('</urlset>', f'{new_entry}\n</urlset>')
        with open(SITEMAP_FILE, 'w') as f:
            f.write(sitemap)
        print(f'Updated sitemap with {blog_url}')

# Commit and push
os.chdir(REPO_DIR)
subprocess.run(['git', 'config', 'user.email', 'chase@appcatalyst.org'], check=True)
subprocess.run(['git', 'config', 'user.name', 'Chase Kellis'], check=True)
subprocess.run(['git', 'add', 'blogs/schedule.json', 'src/blogData.js', 'public/sitemap.xml'], check=True)
subprocess.run(['git', 'commit', '-m', f'Publish blog {next_num}: {blog["title"]}'], check=True)
subprocess.run(['git', 'push'], check=True)

print(f'Published blog {next_num}: {blog["title"]}')
print(f'Next blog: {schedule["next"]}')

# Ping Google Search Console to index the new blog URL
gsc_key = os.environ.get('GSC_SERVICE_ACCOUNT_JSON')
if gsc_key:
    try:
        import tempfile
        key_file = os.path.join(tempfile.gettempdir(), 'gsc-key.json')
        with open(key_file, 'w') as f:
            f.write(gsc_key)

        # Use subprocess to call the indexing API via curl with OAuth token
        import urllib.request, urllib.parse
        from json import loads as jloads

        # Get access token using service account
        import time, hashlib, hmac, base64
        sa = json.loads(gsc_key)
        # Build JWT
        header = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=')
        now = int(time.time())
        claim = base64.urlsafe_b64encode(json.dumps({
            "iss": sa["client_email"],
            "scope": "https://www.googleapis.com/auth/indexing",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now, "exp": now + 3600
        }).encode()).rstrip(b'=')

        # Sign with RSA
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        private_key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
        signature = private_key.sign(header + b'.' + claim, padding.PKCS1v15(), hashes.SHA256())
        sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b'=')
        jwt_token = (header + b'.' + claim + b'.' + sig_b64).decode()

        # Exchange JWT for access token
        token_data = urllib.parse.urlencode({
            'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion': jwt_token
        }).encode()
        token_req = urllib.request.Request('https://oauth2.googleapis.com/token', data=token_data)
        token_resp = json.loads(urllib.request.urlopen(token_req).read())
        access_token = token_resp['access_token']

        # Request indexing
        blog_url = f'https://pokemontrainercenter.com/blog/{slug}'
        idx_data = json.dumps({"url": blog_url, "type": "URL_UPDATED"}).encode()
        idx_req = urllib.request.Request(
            'https://indexing.googleapis.com/v3/urlNotifications:publish',
            data=idx_data,
            headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {access_token}'}
        )
        urllib.request.urlopen(idx_req)
        print(f'[GSC] Indexing requested for {blog_url}')

        os.remove(key_file)
    except Exception as e:
        print(f'[GSC] Indexing ping failed (non-fatal): {e}')
else:
    print('[GSC] No GSC_SERVICE_ACCOUNT_JSON env var, skipping indexing ping')
