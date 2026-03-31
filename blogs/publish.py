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

# Commit and push both files
os.chdir(REPO_DIR)
subprocess.run(['git', 'config', 'user.email', 'chase@appcatalyst.org'], check=True)
subprocess.run(['git', 'config', 'user.name', 'Chase Kellis'], check=True)
subprocess.run(['git', 'add', 'blogs/schedule.json', 'src/blogData.js'], check=True)
subprocess.run(['git', 'commit', '-m', f'Publish blog {next_num}: {blog["title"]}'], check=True)
subprocess.run(['git', 'push'], check=True)

print(f'Published blog {next_num}: {blog["title"]}')
print(f'Next blog: {schedule["next"]}')
