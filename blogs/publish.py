import json, os, subprocess

BLOG_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEDULE_FILE = os.path.join(BLOG_DIR, 'schedule.json')
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

# Mark as published and advance to next
blog['status'] = 'published'
schedule['next'] = next_num + 1

with open(SCHEDULE_FILE, 'w') as f:
    json.dump(schedule, f, indent=2)

# Commit and push the schedule update
os.chdir(REPO_DIR)
subprocess.run(['git', 'config', 'user.email', 'chase@appcatalyst.org'], check=True)
subprocess.run(['git', 'config', 'user.name', 'Chase Kellis'], check=True)
subprocess.run(['git', 'add', 'blogs/schedule.json'], check=True)
subprocess.run(['git', 'commit', '-m', f'Publish blog {next_num}: {blog["title"]}'], check=True)
subprocess.run(['git', 'push'], check=True)

print(f'Published blog {next_num}: {blog["title"]}')
print(f'Next blog: {schedule["next"]}')
