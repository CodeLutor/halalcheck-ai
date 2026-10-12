const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/api/certification-bodies", (req, res) => {
  const bodies = [
    {
  name: "JAKIM",
  country: "Malaysia",
  website: "https://www.halal.gov.my/",
  recognitionStatus: "NOT YET VERIFIED",
  recognitionEvidence:
    "Check the relevant importing country's official recognition list.",
  evidenceSource: "https://www.halal.gov.my/"
},
    {
  name: "BPJPH",
  country: "Indonesia",
  website: "https://halal.go.id/",
  recognitionStatus: "NOT YET VERIFIED",
  recognitionEvidence:
    "Check the relevant importing country's official recognition list.",
  evidenceSource: "https://halal.go.id/"
},    
     {
  name: "MUIS",
  country: "Singapore",
  website: "https://www.muis.gov.sg/",
  recognitionStatus: "NOT YET VERIFIED",
  recognitionEvidence:
    "Check the relevant importing country's official recognition list.",
  evidenceSource: "https://www.muis.gov.sg/"
},    
     {
  name: "IFANCA",
  country: "United States",
  website: "https://ifanca.org/",
  recognitionStatus: "NOT YET VERIFIED",
  recognitionEvidence:
    "Check the relevant importing country's official recognition list.",
  evidenceSource: "https://ifanca.org/"
},
    {
  name: "Halal Food Authority",
  country: "United Kingdom",
  website: "https://halalfoodauthority.com/",
  recognitionStatus: "NOT YET VERIFIED",
  recognitionEvidence:
    "Check the relevant importing country's official recognition list.",
  evidenceSource: "https://halalfoodauthority.com/"
},
  ];

  res.json({
    note: "Directory entries only. Product-specific halal certification has not been verified.",
    bodies
  });
});
app.get("/api/products", async (req, res) => {
  const query = String(req.query.q || "").trim();
  console.log("Product search query:", query, "| Mode:", req.query.mode);
  const isBarcode =
  req.query.mode === "barcode"
    ? true
    : req.query.mode === "name"
    ? false
    : /^\d{8,14}$/.test(query);

  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({
      error: "Enter a product name between 2 and 100 characters."
    });
  }

  try {
    const url = new URL(
      "https://world.openfoodfacts.net/cgi/search.pl"
    );

    if (isBarcode) {
  url.pathname = "/api/v2/product/" + encodeURIComponent(query) + ".json";
} else {
  url.searchParams.set("search_terms", query);
  url.searchParams.set("sort_by", "unique_scans_n");
}
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "10");
console.log("API request URL:", url.toString());
    url.searchParams.set(
      "fields",
      "code,product_name,brands,quantity,countries,ingredients_text,ingredients_text_en,image_front_url,url"
    );

    const response = await fetch(url, {
      headers: {
        "User-Agent": "HalalCheckAI/0.1"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const details = await response.text();
throw new Error(
  `Product database unavailable (HTTP ${response.status}): ${details.slice(0, 300)}`
);
    }

    const data = await response.json();
    console.log(
  "API results:",
  (data.products || []).slice(0, 3).map(p => p.product_name)
);
if (isBarcode) {
  data.products =
    data.status === 1 && data.product
      ? [data.product]
      : [];
}
   const products = (data.products || [])
  .filter(p => p.product_name && p.code)
  .map(p => {
    const ingredients =
      p.ingredients_text_en || p.ingredients_text || "";

    const ingredientText = ingredients.toLowerCase();
    let status = "NOT YET VERIFIED";
    let explanation =
      "No screening conclusion is available yet. Check reliable halal certification evidence.";
let certificationStatus = "NOT VERIFIED";
let certificationEvidence =
  "No verified halal certification record has been checked.";
    let flaggedIngredients = [];

    if (!ingredients.trim()) {
      status = "INSUFFICIENT INFORMATION";
      explanation =
        "The ingredient list is missing from this database record.";
    } else {
      const prohibitedPatterns = [
        /\bpork\b/i,
        /\bporcine\b/i,
        /\blard\b/i,
        /\bbacon\b/i,
        /\bham\b/i
      ];

      const needsVerificationPatterns = [
        /\bgelatin\b/i,
        /\bgelatine\b/i,
        /\benzymes?\b/i,
        /\bglycerin\b/i,
        /\bglycerol\b/i,
        /\be471\b/i,
        /\be472[a-d]?\b/i,
        /\brennet\b/i,
        /\bmono-? and diglycerides\b/i,
        /\bnatural flavours?\b/i,
        /\bnatural flavors?\b/i,
        /\bshortening\b/i,
        /\bwine\b/i,
        /\brum\b/i,
        /\bbrandy\b/i,
        /\bbeer\b/i
      ];

      flaggedIngredients = [
  { pattern: /\bpork\b/i, name: "Pork" },
  { pattern: /\bporcine\b/i, name: "Porcine-derived ingredient" },
  { pattern: /\blard\b/i, name: "Lard" },
  { pattern: /\bbacon\b/i, name: "Bacon" },
  { pattern: /\bham\b/i, name: "Ham" }
]
  .filter(item => item.pattern.test(ingredientText))
  .map(item => item.name);

      if (flaggedIngredients.length > 0) {
        status = "POTENTIAL PROHIBITED INGREDIENT";
        explanation =
          "The listed ingredients contain a term associated with a prohibited ingredient. Verify the product label and source before making a final decision.";
      } else {
        flaggedIngredients = [
  { pattern: /\bgelatin\b/i, name: "Gelatin" },
  { pattern: /\bgelatine\b/i, name: "Gelatine" },
  { pattern: /\benzymes?\b/i, name: "Enzymes" },
  { pattern: /\bglycerin\b/i, name: "Glycerin" },
  { pattern: /\bglycerol\b/i, name: "Glycerol" },
  { pattern: /\be471\b/i, name: "E471" },
  { pattern: /\be472[a-d]?\b/i, name: "E472" },
  { pattern: /\brennet\b/i, name: "Rennet" },
  { pattern: /\bmono-? and diglycerides\b/i, name: "Mono- and diglycerides" },
  { pattern: /\bnatural flavours?\b/i, name: "Natural flavouring" },
  { pattern: /\bnatural flavors?\b/i, name: "Natural flavoring" },
  { pattern: /\bshortening\b/i, name: "Shortening" },
  { pattern: /\bwine\b/i, name: "Wine" },
  { pattern: /\brum\b/i, name: "Rum" },
  { pattern: /\bbrandy\b/i, name: "Brandy" },
  { pattern: /\bbeer\b/i, name: "Beer" }
]
  .filter(item => item.pattern.test(ingredientText))
  .map(item => item.name);

       if (flaggedIngredients.length > 0) {
  status = "HARAM";
  explanation =
    "A potential prohibited ingredient was detected: " +
    flaggedIngredients.join(", ") +
    ". Verify the product label and ingredient source before making a final decision.";
} else {
  status = "UNCERTAIN";
  explanation =
    "No obvious prohibited ingredient was detected by the automated screen, but halal status has not been confirmed. Check reliable halal certification and the complete ingredient list.";
}
    return {
      barcode: p.code,
      name: p.product_name,
      brand: p.brands || "",
      quantity: p.quantity || "",
      countries: p.countries || "",
      ingredients,
      image: p.image_front_url || "",
      sourceUrl: p.url || "",
     halalScreening: {
  status,
  explanation,
  flaggedIngredients
},
certification: {
  status: certificationStatus,
  evidence: certificationEvidence
}    };
  });
    res.json({ query, products });
  } catch (error) {
    console.error("PRODUCT API ERROR:", error);

    res.status(502).json({
      error: "Could not retrieve products. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HalalCheck AI is running at http://localhost:${PORT}`);
});
