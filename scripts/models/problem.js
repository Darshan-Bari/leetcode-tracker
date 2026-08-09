import LanguageUtils from "../utils/language-utils.js";

export default class Problem {
  constructor() {
    this.slug = "";
    this.description = "";
    this.problemUrl = "";
    this.code = "";
    this.language = {};
  }

  loadProblemFromDOM() {
    const url = this.getDescriptionUrl();

    if (url) {
      this.extractProblemInfos(url);
    }
  }

  getDescriptionUrl() {
    const url = window.location.href;

    if (url.includes("leetcode.com/problems/")) {
      const problemName = url
        .replace("https://leetcode.com/problems/", "")
        .split("/")[0];

      this.problemUrl = `/problems/${problemName}/`;
      return `https://leetcode.com/problems/${problemName}/description/`;
    }

    return "";
  }

  applySubmissionDetails(details = {}) {
    const languageKey = details.language || details.lang?.name || details.langName;
    const language = LanguageUtils.getLanguageInfo(languageKey);
    if (language) this.language = language;
    if (typeof details.code === "string") this.code = details.code;

    const questionId = String(details.questionId || "").trim();
    const titleSlug = String(details.titleSlug || "").trim();
    if (questionId && titleSlug) {
      const title = titleSlug
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
      this.slug = `${questionId}-${title}`;
      this.problemUrl = `/problems/${titleSlug}/`;
    }
  }

  extractLanguageFromDOM() {
    let language = "";
    const storedLanguage = window.localStorage.getItem("global_lang");
    if (storedLanguage) {
      try {
        const parsed = JSON.parse(storedLanguage);
        language = typeof parsed === "string"
          ? parsed
          : parsed?.value || parsed?.langSlug || parsed?.name || "";
      } catch (_) {
        language = storedLanguage;
      }
    }

    if (!language) {
      const selectors = [
        '[data-e2e-locator="console-language-button"]',
        '[data-cy="lang-select"]',
        'button[id^="headlessui-popover-button"]',
      ];
      for (const selector of selectors) {
        const text = document.querySelector(selector)?.textContent?.trim();
        if (LanguageUtils.getLanguageInfo(text)) {
          language = text;
          break;
        }
      }
    }

    this.language = LanguageUtils.getLanguageInfo(language);
    if (!this.language) {
      throw new Error("Unable to determine the submitted language.");
    }
    return this.language;
  }

  extractCodeFromDOM() {
    let code = "";
    if (this.language?.langName) {
      const languageElements = document.querySelectorAll(
        `code.language-${this.language.langName}`
      );
      code = languageElements[languageElements.length - 1]?.textContent || "";
    }

    if (!code) {
      const codeElements = document.querySelectorAll('code[class*="language-"]');
      code = codeElements[codeElements.length - 1]?.textContent || "";
    }

    if (!code) {
      const editorLines = document.querySelectorAll(".monaco-editor .view-lines .view-line");
      if (editorLines.length) {
        code = Array.from(editorLines, (line) => line.textContent || "").join("\n");
      }
    }

    if (!code) {
      const textarea = document.querySelector(
        '[data-e2e-locator="console-code-editor"] textarea, .monaco-editor textarea'
      );
      code = textarea?.value || "";
    }

    this.code = code;
    if (!this.code.trim()) {
      throw new Error("Unable to read the accepted solution code.");
    }
    return this.code;
  }

  validateForSubmission() {
    if (!this.slug) throw new Error("Unable to determine the problem name.");
    if (!this.language?.extension || !this.language?.langName) {
      throw new Error("Unable to determine the submitted language.");
    }
    if (!this.code?.trim()) throw new Error("Unable to read the accepted solution code.");
    return true;
  }

  extractProblemInfos(url) {
    const iframe = document.createElement("iframe");

    // Invisible iframe
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    iframe.src = url;

    // Observer to retrieve data from the iframe
    iframe.onload = () => {
      const iframeDocument =
        iframe.contentDocument || iframe.contentWindow.document;

      const observer = new MutationObserver((mutations, obs) => {
        // Extract data from the iframe
        this.extractDescriptionFromDOM(iframeDocument);
        this.extractSlugFromDOM(iframeDocument);

        // If all required data is extracted, stop the observer
        if (this.description && this.slug) {
          obs.disconnect();
          document.body.removeChild(iframe);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Stop the observer after 3 seconds and remove the iframe
      setTimeout(() => {
        observer.disconnect();
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 3000);
    };

    document.body.appendChild(iframe);
  }

  async extractSlugFromDOM(iframeContent) {
    const problemNameSelector = iframeContent.querySelector(
      `a[href='${this.problemUrl}']`
    );

    if (problemNameSelector) {
      this.slug = this.formatProblemName(problemNameSelector.textContent);
    }
  }

  async extractDescriptionFromDOM(iframeDocument) {
    const problemDescription = iframeDocument.querySelector(
      'div[data-track-load="description_content"]'
    );
    if (problemDescription) {
      this.description = problemDescription.textContent;
    }
  }

  formatProblemName(problemName) {
    if (!problemName) {
      return "";
    }

    let formatted = problemName.toString().trim();

    formatted = formatted.replace(/\./g, "-").replace(/\s+/g, "");

    formatted = formatted.replace(/^[\/\-_]+|[\/\-_]+$/g, '');

    formatted = formatted.replace(/\//g, '-');

    return formatted;
  }
}
