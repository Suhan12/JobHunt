const express = require("express");
const app = express();
const PORT = 4001;

app.get("/greenhouse-demo", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Greenhouse Job Application - Data Analyst @ Transport For NSW</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 40px; }
        .container { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
        h1 { font-size: 24px; color: #0f172a; margin-bottom: 4px; }
        .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; }
        .field { margin-bottom: 20px; }
        label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #334155; }
        input[type="text"], input[type="email"], input[type="tel"], textarea {
          width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 6px; font-size: 14px; color: #0f172a; background: #f8fafc; outline: none; transition: border-color 0.2s;
        }
        input:focus, textarea:focus { border-color: #2563eb; background: #ffffff; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
        textarea { height: 220px; resize: vertical; font-family: inherit; line-height: 1.5; }
        .btn-submit { background: #2563eb; color: white; border: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; cursor: pointer; margin-top: 10px; }
        .badge { background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <span class="badge">Greenhouse ATS Application Form</span>
        <h1>Apply for Data Analyst</h1>
        <div class="subtitle">Transport For NSW — Sydney, Australia (Hybrid)</div>
        <form id="application_form" onsubmit="return false;">
          <div class="field">
            <label for="first_name">First Name <span style="color:red">*</span></label>
            <input type="text" id="first_name" name="job_application[first_name]" autocomplete="given-name" required />
          </div>
          <div class="field">
            <label for="last_name">Last Name <span style="color:red">*</span></label>
            <input type="text" id="last_name" name="job_application[last_name]" autocomplete="family-name" required />
          </div>
          <div class="field">
            <label for="email">Email Address <span style="color:red">*</span></label>
            <input type="email" id="email" name="job_application[email]" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="phone">Phone Number <span style="color:red">*</span></label>
            <input type="tel" id="phone" name="job_application[phone]" autocomplete="tel" required />
          </div>
          <div class="field">
            <label for="linkedin_url">LinkedIn Profile URL</label>
            <input type="text" id="linkedin_url" name="job_application[urls][LinkedIn]" placeholder="https://linkedin.com/in/username" />
          </div>
          <div class="field">
            <label for="github_url">GitHub / Portfolio URL</label>
            <input type="text" id="github_url" name="job_application[urls][GitHub]" placeholder="https://github.com/username" />
          </div>
          <div class="field">
            <label for="cover_letter_text">Cover Letter</label>
            <textarea id="cover_letter_text" name="job_application[cover_letter_text]" placeholder="Paste your cover letter here..."></textarea>
          </div>
          <button type="button" id="submit_app_button" class="btn-submit">Submit Application</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

const server = app.listen(PORT, () => {
  console.log(`Greenhouse mock server running on http://localhost:${PORT}/greenhouse-demo`);
});
