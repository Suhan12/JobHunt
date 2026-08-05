const googleIt = require("google-it");

/**
 * Extract human name from LinkedIn search title/snippet
 * Example LinkedIn title: "Renee Gaudzinski - Senior Talent Acquisition Partner - Transport for NSW | LinkedIn"
 * Example snippet: "... Renee Gaudzinski ... Hiring Manager ..."
 */
function extractNameFromLinkedInResult(title, snippet) {
  const text = `${title} ${snippet}`;

  // Standard LinkedIn title format: "Name - Title - Company | LinkedIn" or "Name | LinkedIn"
  const titleParts = title.split(/[-–|]/);
  if (titleParts.length > 0) {
    const rawName = titleParts[0].trim();
    // Validate rawName: should be 2-3 words, only letters/spaces/hyphens
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(rawName)) {
      return rawName;
    }
  }

  // Regex regex match for 2-capitalized word names in text
  const match = text.match(/\b([A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20})\b/);
  if (match) {
    const candidate = match[1];
    // Ignore common non-name capitalized words
    const ignoreList = ["Transport For", "Transport NSW", "Hiring Manager", "Senior Talent", "Talent Acquisition", "LinkedIn Profile", "Data Analyst", "Software Engineer"];
    if (!ignoreList.some((ign) => candidate.toLowerCase().includes(ign.toLowerCase()))) {
      return candidate;
    }
  }

  return null;
}

async function discoverHiringManager(companyName) {
  const query = `site:linkedin.com/in/ "${companyName}" ("hiring manager" OR "talent" OR "recruiter")`;
  console.log(`🔎 Searching: ${query}`);

  try {
    const results = await googleIt({ query, limit: 3, "no-display": true });
    for (const result of results.slice(0, 3)) {
      console.log(`   Result: "${result.title}"`);
      const extracted = extractNameFromLinkedInResult(result.title || "", result.snippet || "");
      if (extracted) {
        console.log(`   🎯 Extracted Name: ${extracted}`);
        return extracted;
      }
    }
  } catch (err) {
    console.warn(`   ⚠️ Search failed (${err.message}) - defaulting to 'Hiring Team'`);
  }

  console.log(`   ℹ️ No name found. Defaulting to 'Hiring Team'`);
  return "Hiring Team";
}

discoverHiringManager("Transport For NSW");
