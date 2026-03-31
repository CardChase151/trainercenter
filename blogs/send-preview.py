import json, os, smtplib, ssl, markdown
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

BLOG_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEDULE_FILE = os.path.join(BLOG_DIR, 'schedule.json')

SENDER = 'chase@appcatalyst.org'
PASSWORD = os.environ.get('ZOHO_PASSWORD')
RECIPIENTS = [
    'thek2way17@gmail.com',
    'trainercenter.pokemon@gmail.com',
    'mr.chef68@gmail.com'
]

with open(SCHEDULE_FILE) as f:
    schedule = json.load(f)

next_num = schedule['next']
if next_num > schedule['total']:
    print('All blogs have been sent.')
    exit(0)

blog = next((b for b in schedule['blogs'] if b['num'] == next_num), None)
if not blog:
    print(f'Blog {next_num} not found in schedule.')
    exit(1)

blog_path = os.path.join(BLOG_DIR, blog['file'])
with open(blog_path) as f:
    blog_content = f.read()

blog_html = markdown.markdown(blog_content)

subject = f"Trainer Center Blog Preview ({blog['num']}/{schedule['total']}): {blog['title']}"

html = f'''\
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f6f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 800px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color: #C8102E; padding: 28px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">Trainer Center Blog</h1>
              <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">Weekly Blog Preview</p>
            </td>
          </tr>

          <!-- Notice -->
          <tr>
            <td style="padding: 24px 32px 0 32px;">
              <div style="background-color: #fff0f0; border-left: 3px solid #C8102E; padding: 16px 20px; border-radius: 0 6px 6px 0;">
                <p style="font-size: 14px; color: #C8102E; font-weight: 600; margin: 0 0 6px 0;">This blog goes live tomorrow (Tuesday)</p>
                <p style="font-size: 13px; color: #666; margin: 0;">If you have changes, reply to this email today. If we don't hear back, it publishes automatically.</p>
              </div>
            </td>
          </tr>

          <!-- Blog Content -->
          <tr>
            <td style="padding: 24px 32px 32px 32px;">
              <div style="font-size: 15px; color: #333; line-height: 1.7;">
                {blog_html}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #1a1a1a; padding: 18px 32px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">Blog {blog['num']} of {schedule['total']} | Trainer Center | pokemontrainercenter.com</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
'''

msg = MIMEMultipart('mixed')
msg['From'] = 'Chase Kellis <chase@appcatalyst.org>'
msg['To'] = ', '.join(RECIPIENTS)
msg['Subject'] = subject
msg.attach(MIMEText(html, 'html'))

context = ssl.create_default_context()
with smtplib.SMTP_SSL('smtp.zoho.com', 465, context=context) as server:
    server.login(SENDER, PASSWORD)
    server.sendmail(SENDER, RECIPIENTS, msg.as_string())
    print(f'Preview email sent for blog {next_num}: {blog["title"]}')
