const { getSharePointAccessToken } = require("./msgraphAuth");

const STATIC_SITE_ID = process.env.SHAREPOINT_TEMPLATE_SITE_ID; // AuditProjects site
const STATIC_DRIVE_ID = process.env.SHAREPOINT_TEMPLATE_DRIVE_ID; // Shared Documents drive
const STATIC_TEMPLATE_PATH = "Templates/Template files for Client portal";

exports.listTemplateFiles = async (req, res) => {
  try {
    console.log(req.user);
    const accessToken = await getSharePointAccessToken();

    // Graph API endpoint
    const url = `https://graph.microsoft.com/v1.0/sites/${STATIC_SITE_ID}/drives/${STATIC_DRIVE_ID}/root:/${encodeURIComponent(
      STATIC_TEMPLATE_PATH
    )}:/children`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const txt = await response.text();
      return res.status(response.status).json({ error: txt });
    }

    const json = await response.json();
    const files = (json.value || []).map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      lastModified: f.lastModifiedDateTime,
      downloadUrl: f["@microsoft.graph.downloadUrl"], // direct link to download
    }));

    res.json(files);
  } catch (err) {
    console.error("Template list error:", err);
    res.status(500).json({ error: err.message });
  }
};
