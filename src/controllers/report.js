const { getSharePointAccessToken } = require("./msgraphAuth");

const STATIC_SITE_ID = process.env.SHAREPOINT_SITE_ID;
const PDRIVE_ID = process.env.SHAREPOINT_PROJECTS_ID;

exports.reportController = async (req, res) => {
  try {
    // хэрэглэгчийн companyName — энэ login-оос ирнэ
    const companyName = req.user?.companyName;
    const companyNameMN = req.user?.companyNameMN;
    const projectNname = req.user?.projectName;
    if (!companyName) return res.status(401).json({ error: "Unauthorized (no company name)" });

    const accessToken = await getSharePointAccessToken();
    if (!accessToken) return res.status(500).json({ error: "Failed to acquire SharePoint token" });

    // Templates/<CompanyName> хавтасны path
    const folderPath = `/${companyNameMN}/${projectNname}/3. Тайлагнал`;


    const url = `https://graph.microsoft.com/v1.0/sites/${STATIC_SITE_ID}/drives/${PDRIVE_ID}/root:/${encodeURIComponent(
      folderPath
    )}:/children`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const txt = await response.text();
      return res.status(response.status).json({ error: txt });
    }

    const json = await response.json();

    const files = (json.value || [])
      .filter((f) => f.file) // зөвхөн файлууд
      .map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        lastModified: f.lastModifiedDateTime,
        downloadUrl: f["@microsoft.graph.downloadUrl"],
        webUrl: f.webUrl,
      }));

    res.json({
      company: companyName,
      count: files.length,
      files,
    });
  } catch (err) {
    console.error("report error:", err);
    res.status(500).json({ error: err.message });
  }
};
