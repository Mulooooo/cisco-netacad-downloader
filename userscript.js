// ==UserScript==
// @name         Cisco NetAcad Downloader
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  J'ai la flemme de tout lire alors maintenant on peut exporter les cours en markdown pour les donner a des ia (j'ai passé plus de temps a faire le script que si j'avais juste lu les cours mais c'est pas grave)
// @author       MULO
// @match        https://*.netacad.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SELECTORS = {
        TOOLBAR: '.contentActionsRight--nlg8g',
        ROOT_CANDIDATES: ['.co-content-scroll', 'main', '[role="main"]', '#app-mount-point', 'body'],
        TITLE: '.selectedNodeName--0-Ywu'
    };

    // --- CONFIGURATION DU NETTOYAGE ---
    const IGNORED_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'NAV', 'HEADER', 'FOOTER', 'SVG', 'FORM', 'IFRAME'];

    // Filtres anti-bruit (Menus, Quiz, Interface)
    const IGNORED_TEXT_PATTERNS = [
        /^Complet$/, /^Incomplet$/, /^Menu$/, /^Sommaire$/,
        /Faites défiler pour commencer/, /^close$/,
        /^Instructions:$/, /Démarrer/,
        /La progression a été chargée/,
        /Vérifiez votre compréhension/,
        /L'examen comprend/, /nécessaires pour réussir/, /nombre illimité de tentatives/, /limite de temps/,
        /Identifiant\s*:/, /Mot de passe\s*:/
    ];

    const IGNORED_CLASSES = ['course-header', 'footer', 'nav-buttons', 'toast', 'notification', 'accessibility-hidden'];

    // --- UTILITAIRES ---
    function makeAbsolute(url) {
        if (!url) return "";
        try { return new URL(url, window.location.href).href; } catch (e) { return url; }
    }

    function isVisible(node) {
        if (node.nodeType === Node.TEXT_NODE) return true;
        if (node.nodeType !== Node.ELEMENT_NODE) return false;

        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (IGNORED_CLASSES.some(cls => node.classList.contains(cls))) return false;
        return true;
    }

    function isBlockElement(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const style = window.getComputedStyle(node);
        return ['block', 'flex', 'grid', 'table', 'list-item'].includes(style.display) ||
               ['DIV', 'P', 'SECTION', 'ARTICLE', 'H1','H2','H3','H4','H5','H6', 'UL', 'OL', 'LI'].includes(node.tagName);
    }

    // --- PARSER ---
    function traverseNode(node, listDepth = 0) {
        if (!node) return "";

        // 1. Filtrage basique
        if (node.nodeType === Node.COMMENT_NODE) return "";
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (IGNORED_TAGS.includes(node.tagName)) return "";
            if (!isVisible(node)) return "";
            if (node.getAttribute('aria-hidden') === 'true') return "";
        }

        // 2. Gestion du Texte
        if (node.nodeType === Node.TEXT_NODE) {
            let text = node.textContent.replace(/\s+/g, ' ');
            if (IGNORED_TEXT_PATTERNS.some(regex => regex.test(text.trim()))) return "";
            return text;
        }

        let childMarkdown = "";
        const tagName = node.tagName;
        let isBlock = isBlockElement(node);

        // 3. TRAVERSÉE (SHADOW DOM & SLOTS)
        let nodesToTraverse = [];

        if (node.shadowRoot) {
            nodesToTraverse = Array.from(node.shadowRoot.childNodes);
        } else if (tagName === 'SLOT') {
            nodesToTraverse = node.assignedNodes();
        } else {
            nodesToTraverse = Array.from(node.childNodes);
        }

        nodesToTraverse.forEach(child => {
            let nextDepth = (tagName === 'UL' || tagName === 'OL') ? listDepth + 1 : listDepth;
            childMarkdown += traverseNode(child, nextDepth);
        });

        childMarkdown = childMarkdown.trim();

        if (!childMarkdown && !['IMG', 'HR', 'BR'].includes(tagName)) return "";

        // 4. DETECTION INTELLIGENTE DES TITRES (NOUVEAU)
        // Si le contenu commence par "1.2 " ou "1.2.3 ", on force un titre ##
        // peu importe si c'était un <p>, une <div> ou autre chose.
        const titleRegex = /^\d+\.\d+(\.\d+)?\s+/;
        if (isBlock && titleRegex.test(childMarkdown) && childMarkdown.length < 100) {
            return `\n## ${childMarkdown}\n\n`;
        }

        // 5. FORMATAGE MARKDOWN STANDARD
        switch (tagName) {
            case 'H1': return `\n# ${childMarkdown}\n\n`;
            case 'H2': return `\n## ${childMarkdown}\n\n`;
            case 'H3': return `\n### ${childMarkdown}\n\n`;
            case 'H4': case 'H5': case 'H6': return `\n#### ${childMarkdown}\n\n`;

            case 'P': return `\n${childMarkdown}\n\n`;
            case 'BR': return `  \n`;
            case 'HR': return `\n---\n`;

            case 'B': case 'STRONG': return ` **${childMarkdown}** `;
            case 'I': case 'EM': return ` *${childMarkdown}* `;
            case 'CODE': return ` \`${childMarkdown}\` `;
            case 'PRE': return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;

            case 'UL': case 'OL': return `\n${childMarkdown}\n`;
            case 'LI':
                let indent = "  ".repeat(Math.max(0, listDepth - 1));
                return `\n${indent}- ${childMarkdown}`;

            case 'A':
                const href = node.getAttribute('href');
                if (!href || href.startsWith('javascript') || href === '#') return childMarkdown;
                return `[${childMarkdown}](${makeAbsolute(href)})`;

            case 'IMG':
                let src = node.getAttribute('src');
                const alt = node.getAttribute('alt') || "";
                if (!src) return "";
                if (src.includes('data:image/svg') && (!alt || alt.length < 2)) return "";
                return `\n![${alt}](${makeAbsolute(src)})\n`;

            case 'TABLE': return `\n\n> **Tableau :**\n> ${childMarkdown.replace(/\n/g, ' / ')}\n\n`;
            case 'TR': return `| ${childMarkdown} |\n`;
            case 'TD': case 'TH': return ` ${childMarkdown} |`;

            default:
                // Si c'est un bloc div qui contient du texte simple, on le sépare par des sauts de ligne
                return isBlock ? `\n${childMarkdown}\n` : childMarkdown;
        }
    }

    // --- POST-TRAITEMENT ---
    function cleanMarkdown(md) {
        return md
            .replace(/\r\n/g, '\n')

            // Nettoyage final des patterns de description visuelle s'il en reste
            .replace(/> ℹ️ \*Description visuelle :\*/g, '')

            // Force les sauts de ligne avant les titres ## générés
            .replace(/([^\n])\n(## )/g, '$1\n\n$2')

            // Nettoyage espaces
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\s*-\s*\n/gm, '')
            .replace(/ \*\*/g, ' **').replace(/\*\* /g, '** ')
            .trim();
    }

    // --- LOGIQUE PRINCIPALE ---
    function handleDownloadClick() {
        console.log("Extraction v10.0 (No Descriptions)...");
        let iframe = document.querySelector('iframe[title="Course content"]');
        let doc = document;
        let rootNode = null;

        if (iframe) {
            try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch(e) {}
        }

        for (let selector of SELECTORS.ROOT_CANDIDATES) {
            rootNode = doc.querySelector(selector);
            if (rootNode) break;
        }
        if (!rootNode) rootNode = doc.body;

        let markdown = traverseNode(rootNode);
        markdown = cleanMarkdown(markdown);

        const titleEl = document.querySelector(SELECTORS.TITLE);
        let filename = titleEl ? titleEl.textContent.trim() : "Cours_NetAcad";
        filename = filename.replace(/[^a-z0-9à-ú\s.-]/gi, '_').substring(0, 50) + ".md";

        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // --- BOUTON UI ---
    function checkAndAddButton() {
        if (document.getElementById('netacad-md-btn')) return;
        const toolbar = document.querySelector(SELECTORS.TOOLBAR);

        if (toolbar) {
            const btnContainer = document.createElement('div');
            btnContainer.className = 'btnContainer--T1Oi3';
            const btn = document.createElement('button');
            btn.id = 'netacad-md-btn';

            // 1. Ajout de 'transition' pour l'effet fluide
            btn.style.cssText = `
                display: flex; align-items: center; justify-content: center;
                width: 36px; height: 36px;
                background-color: #ffffff; border: 2px solid #00bceb; border-radius: 4px;
                cursor: pointer; margin-right: 8px;
                transition: all 0.3s ease;
            `;

            btn.title = 'Télécharger le cours (Markdown)';

            // On stocke le SVG original dans une variable pour pouvoir le remettre plus tard
            const originalIcon = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#005073" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            `;

            btn.innerHTML = originalIcon;

            btn.addEventListener('mouseenter', () => {
                // On ne change la couleur au survol que si on n'est pas en mode "succès" (vert)
                if (btn.style.borderColor !== 'rgb(40, 167, 69)') {
                    btn.style.backgroundColor = '#f4f4f4';
                }
            });
            btn.addEventListener('mouseleave', () => btn.style.backgroundColor = '#ffffff');

            // On modifie l'appel du click pour inclure l'animation
            btn.addEventListener('click', async (e) => {
                // Appeler ta fonction de téléchargement existante
                await handleDownloadClick(e);

                // 2. Déclencher l'animation de succès une fois fini
                triggerSuccessAnimation(btn, originalIcon);
            });

            toolbar.insertBefore(btnContainer, toolbar.firstChild);
            btnContainer.appendChild(btn);
        }
    }

    // --- FONCTION D'ANIMATION ---
    function triggerSuccessAnimation(btn, originalIcon) {
        // SVG du "Check" (Validé)
        const successIcon = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#28a745" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;

        // Changer le style pour indiquer le succès (Vert)
        btn.style.borderColor = '#28a745'; // Vert succès
        btn.style.backgroundColor = '#e6fffa'; // Fond très léger vert
        btn.innerHTML = successIcon;

        // Revenir à la normale après 2.5 secondes
        setTimeout(() => {
            btn.style.borderColor = '#00bceb'; // Bleu original
            btn.style.backgroundColor = '#ffffff';
            btn.innerHTML = originalIcon;
        }, 2500);
    }

    setInterval(checkAndAddButton, 2000);
})();