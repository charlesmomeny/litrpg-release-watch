/**
 * Diff engine - NUMBER-BASED COMPARISON
 *
 * APPROACH: Track book numbers, not individual items
 * - Extract book numbers from titles (e.g., "Savage Awakening 7" → 7)
 * - Store ALL items with their numbers and ASINs
 * - Compare: Is new max book number > old max?
 * - Alert only when HIGHER numbers appear (with unique ASIN verification)
 *
 * This approach is immune to:
 * - Duplicate items in search results
 * - Changing ASINs
 * - Unstable search result ordering
 */
import { extractAsin } from './utils.js';
export class DiffEngine {
    /** Returns the audit collector from the most recent compareSnapshots call. */
    static getLastAudit() {
        return this.lastAudit;
    }
    /**
     * Returns true if the book's release date is older than the configured threshold.
     * Returns false (allow) if release date is missing, in the future (pre-order),
     * or threshold is disabled.
     */
    static isBookTooOld(releaseDate, maxAgeDays) {
        if (!releaseDate)
            return false; // No date — can't reject what we can't measure
        if (!maxAgeDays || maxAgeDays <= 0)
            return false; // Filter disabled
        const parsed = new Date(releaseDate);
        if (isNaN(parsed.getTime()))
            return false; // Unparseable — allow
        const ageDays = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
        return ageDays > maxAgeDays;
    }
    /**
     * Record a candidate book (accepted or rejected) in the audit collector.
     * Also bumps the rejection counter when rejected.
     */
    static recordCandidate(title, author, bookNumber, asin, accepted, rejectionReason, releaseDate) {
        if (!this.lastAudit)
            return;
        if (this.lastAudit.candidates.length < 30) {
            this.lastAudit.candidates.push({ title, author, bookNumber, asin, accepted, rejectionReason, releaseDate });
        }
        if (!accepted && rejectionReason) {
            this.lastAudit.rejectionReasons[rejectionReason] = (this.lastAudit.rejectionReasons[rejectionReason] || 0) + 1;
        }
    }
    /**
     * Compare snapshots using book number comparison
     * Only alerts when a NEW HIGHER book number appears
     *
     * @param expectedAuthor - If provided, ONLY books by this exact author will pass.
     *                        Can be a single author string or array of acceptable authors
     *                        (for co-authored series like "TheFirstDefier, JF Brink").
     *                        Overrides the "known authors from snapshot" inference,
     *                        which can be polluted by cross-series search results.
     */
    static compareSnapshots(oldSnapshot, newSnapshot, seriesTitle, settings, expectedAuthor, historicalTitlesForSeries) {
        const updates = [];
        // Initialize audit collector for this comparison
        this.lastAudit = {
            detectionMode: 'first-check',
            trustedAuthors: [],
            rejectionReasons: {},
            candidates: []
        };
        // If no old snapshot, this is first check - don't generate updates
        if (!oldSnapshot || !oldSnapshot.items || oldSnapshot.items.length === 0) {
            console.log(`${seriesTitle}: First check, no baseline to compare`);
            this.lastAudit.detectionMode = 'no-snapshot';
            return updates;
        }
        // Extract book numbers and metadata from OLD snapshot
        const oldBooks = this.extractBookData(oldSnapshot.items);
        const oldAsins = new Set(oldBooks.items.map(b => b.asin).filter(a => a !== null));
        // Build a normalized title set for re-release detection.
        // If a new ASIN's title matches a title we've ever seen for this series
        // (either in the previous snapshot OR any historical bookHistory entry),
        // it's almost certainly a re-release or re-encoded edition, not new content.
        const normalizeForDedup = (t) => (t || '').toLowerCase()
            .replace(/['']/g, "'")
            .replace(/[""]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
        const oldTitlesNormalized = new Set(oldSnapshot.items.map(b => normalizeForDedup(b.title)).filter(t => t));
        // Union in any historical titles (from bookHistory) for this series.
        // This survives snapshot rotation — books that dropped out of Audible's
        // top-N results but were previously seen still count as "already seen".
        if (historicalTitlesForSeries) {
            historicalTitlesForSeries.forEach(t => {
                const normalized = normalizeForDedup(t);
                if (normalized)
                    oldTitlesNormalized.add(normalized);
            });
        }
        // Determine the "trusted authors" set:
        // - If expectedAuthor is set: ONLY those authors are trusted (most reliable)
        // - Otherwise: infer from old snapshot (can be polluted)
        let trustedAuthors;
        let trustMode;
        // Normalize expectedAuthor into an array of normalized strings
        const expectedAuthorList = expectedAuthor
            ? (Array.isArray(expectedAuthor) ? expectedAuthor : [expectedAuthor])
                .map(a => a.trim())
                .filter(a => a.length > 0)
            : [];
        if (expectedAuthorList.length > 0) {
            trustedAuthors = new Set(expectedAuthorList.map(a => this.normalizeAuthor(a)));
            trustMode = 'expected';
            console.log(`${seriesTitle}: Using EXPECTED AUTHOR(S) "${expectedAuthorList.join(', ')}" (strict mode)`);
        }
        else {
            trustedAuthors = new Set(oldBooks.items
                .map(b => b.item.author)
                .filter(a => a !== undefined && a !== null)
                .map(a => this.normalizeAuthor(a)));
            trustMode = 'inferred';
            console.warn(`${seriesTitle}: ⚠️ NO expectedAuthor — falling back to INFERRED TRUST from snapshot. This is vulnerable to cross-series pollution. Consider locking the author via the series settings.`);
            console.log(`${seriesTitle}: Inferred known authors:`, Array.from(trustedAuthors));
        }
        // Record trust info in audit
        this.lastAudit.trustMode = trustMode;
        this.lastAudit.trustedAuthors = Array.from(trustedAuthors);
        // Calculate max ONLY from books by trusted authors (prevents pollution from inflating max)
        const oldBooksFromKnownAuthors = oldBooks.items.filter(book => {
            if (!book.item.author)
                return trustMode === 'inferred'; // Keep if no author only in inferred mode
            return this.anyAuthorMatches(book.item.author, trustedAuthors);
        });
        const oldMaxNumber = oldBooksFromKnownAuthors.length > 0
            ? Math.max(...oldBooksFromKnownAuthors.map(b => b.bookNumber || 0))
            : 0;
        // Extract book numbers and metadata from NEW snapshot
        const newBooks = this.extractBookData(newSnapshot.items);
        // Calculate max ONLY from books by trusted authors
        const newBooksFromKnownAuthors = newBooks.items.filter(book => {
            if (!book.item.author)
                return trustMode === 'inferred';
            return this.anyAuthorMatches(book.item.author, trustedAuthors);
        });
        const newMaxNumber = newBooksFromKnownAuthors.length > 0
            ? Math.max(...newBooksFromKnownAuthors.map(b => b.bookNumber || 0))
            : 0;
        console.log(`${seriesTitle} (${newSnapshot.source}): old max=${oldMaxNumber}, new max=${newMaxNumber}`);
        // Backwards-compatibility alias for the rest of the function
        const knownAuthors = trustedAuthors;
        // HYBRID SYSTEM: Check if series has book numbers
        const hasBookNumbers = oldMaxNumber > 0 || newMaxNumber > 0;
        if (!hasBookNumbers) {
            // FALLBACK: ASIN-based detection for series without numbers
            console.log(`${seriesTitle}: No book numbers detected, using ASIN-based detection`);
            this.lastAudit.detectionMode = 'asin';
            // Find new ASINs that weren't in old snapshot
            const newAsins = newBooks.items
                .filter(book => book.asin && !oldAsins.has(book.asin));
            if (newAsins.length === 0) {
                console.log(`${seriesTitle}: No new ASINs found`);
                return updates;
            }
            console.log(`${seriesTitle}: Found ${newAsins.length} new ASINs`);
            // Process each new ASIN
            newAsins.forEach(book => {
                // LANGUAGE CHECK: Reject obvious non-English titles
                if (this.isLikelyNonEnglish(book.item.title)) {
                    console.log(`  Skipping "${book.item.title}": Title appears to be non-English`);
                    /* merged with recordCandidate */
                    this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'non_english', book.item.releaseDate);
                    return;
                }
                // EDITION VARIANT CHECK: Reject foreign-language edition markers in English titles
                // (e.g., "Title (French Edition)", "[Spanish Edition]", "Narración en Español")
                if (this.isForeignEditionVariant(book.item.title)) {
                    console.log(`  Skipping "${book.item.title}": Foreign-language edition variant`);
                    /* merged with recordCandidate */
                    this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'foreign_edition', book.item.releaseDate);
                    return;
                }
                // RE-RELEASE CHECK: If this title already existed in the previous snapshot (with a
                // different ASIN), it's a re-release/re-encoded version, not new content. The user
                // has already been notified about this book under its original ASIN.
                const titleNorm = normalizeForDedup(book.item.title);
                if (titleNorm && oldTitlesNormalized.has(titleNorm)) {
                    console.log(`  Skipping "${book.item.title}": Title already in previous snapshot (likely re-release with new ASIN)`);
                    this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'already_seen_title', book.item.releaseDate);
                    return;
                }
                // MANDATORY author check (even for ASIN-based detection)
                if (!book.item.author) {
                    console.log(`  Skipping "${book.item.title}": No author information (cannot verify)`);
                    /* merged with recordCandidate */
                    this.recordCandidate(book.item.title, undefined, undefined, book.asin || undefined, false, 'missing_author', book.item.releaseDate);
                    return;
                }
                if (knownAuthors.size > 0) {
                    if (!this.anyAuthorMatches(book.item.author, knownAuthors)) {
                        console.log(`  Skipping "${book.item.title}": Author "${book.item.author}" doesn't match known authors`);
                        console.log(`    Expected one of:`, Array.from(knownAuthors));
                        /* merged with recordCandidate */
                        this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'author_mismatch', book.item.releaseDate);
                        return;
                    }
                }
                // STRICT title match - skip when expectedAuthor is locked (author lock is stronger).
                // The strict title check only runs when we have to rely on inferred trust.
                if (trustMode === 'inferred' && !this.strictTitleMatch(seriesTitle, book.item.title)) {
                    console.log(`  Skipping "${book.item.title}": Title does not contain all significant series words`);
                    console.log(`    Series: "${seriesTitle}"`);
                    console.log(`    Book: "${book.item.title}"`);
                    /* merged with recordCandidate */
                    this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'title_mismatch', book.item.releaseDate);
                    return;
                }
                // Check pre-order setting
                if (settings.ignorePreorders && book.item.availability === 'preorder') {
                    console.log(`  Skipping "${book.item.title}": pre-order`);
                    this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'preorder', book.item.releaseDate);
                    return;
                }
                // AGE CHECK: reject books with release dates older than the configured threshold.
                // This catches backlog titles that Audible surfaces into search results long after
                // their original release (they look "new" by ASIN but aren't).
                if (this.isBookTooOld(book.item.releaseDate, settings.maxBookAgeDays)) {
                    console.log(`  Skipping "${book.item.title}": Release date ${book.item.releaseDate} is older than ${settings.maxBookAgeDays} days`);
                    this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, false, 'too_old', book.item.releaseDate);
                    return;
                }
                // New item detected via ASIN!
                updates.push(this.createUpdate(newSnapshot.seriesId, seriesTitle, 'NEW_ITEM', newSnapshot.source, book.item, undefined, book.item.title));
                this.recordCandidate(book.item.title, book.item.author, undefined, book.asin || undefined, true, undefined, book.item.releaseDate);
                console.log(`  ✅ NEW ITEM (ASIN-based): ${book.item.title} by ${book.item.author} (ASIN: ${book.asin})`);
            });
            return updates;
        }
        // NUMBER-BASED DETECTION: Check if any NEW book numbers appeared (higher than old max)
        const newBookNumbers = newBooks.items
            .filter(book => book.bookNumber !== null && book.bookNumber > oldMaxNumber)
            .map(book => book.bookNumber);
        if (newBookNumbers.length === 0) {
            // No new books
            this.lastAudit.detectionMode = 'number';
            return updates;
        }
        // Mark detection mode
        this.lastAudit.detectionMode = 'number';
        // Found new book numbers! Verify they're actually new (not duplicates with different ASINs)
        const uniqueNewBooks = [...new Set(newBookNumbers)].sort((a, b) => a - b);
        uniqueNewBooks.forEach(bookNum => {
            // Get the item(s) for this book number
            const candidates = newBooks.items.filter(b => b.bookNumber === bookNum);
            // Pick the first one (if there are duplicates, doesn't matter which)
            const book = candidates[0];
            // CHECKSUM 1: Verify ASIN is unique (not already in old snapshot)
            if (book.asin && oldAsins.has(book.asin)) {
                console.log(`  Skipping Book ${bookNum}: ASIN ${book.asin} already exists (duplicate)`);
                /* merged with recordCandidate */
                this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'duplicate_asin', book.item.releaseDate);
                return;
            }
            // CHECKSUM 1.5: Reject non-English titles
            if (this.isLikelyNonEnglish(book.item.title)) {
                console.log(`  Skipping Book ${bookNum}: Title appears to be non-English ("${book.item.title}")`);
                /* merged with recordCandidate */
                this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'non_english', book.item.releaseDate);
                return;
            }
            // CHECKSUM 1.75: Reject foreign-language edition variants
            if (this.isForeignEditionVariant(book.item.title)) {
                console.log(`  Skipping Book ${bookNum}: Foreign-language edition variant ("${book.item.title}")`);
                /* merged with recordCandidate */
                this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'foreign_edition', book.item.releaseDate);
                return;
            }
            // CHECKSUM 2: MANDATORY author check (prevents cross-series pollution)
            if (!book.item.author) {
                console.log(`  Skipping Book ${bookNum}: No author information (cannot verify)`);
                /* merged with recordCandidate */
                this.recordCandidate(book.item.title, undefined, bookNum, book.asin || undefined, false, 'missing_author', book.item.releaseDate);
                return;
            }
            if (knownAuthors.size > 0) {
                if (!this.anyAuthorMatches(book.item.author, knownAuthors)) {
                    console.log(`  Skipping Book ${bookNum}: Author "${book.item.author}" doesn't match known authors (cross-series pollution)`);
                    console.log(`    Expected one of:`, Array.from(knownAuthors));
                    /* merged with recordCandidate */
                    this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'author_mismatch', book.item.releaseDate);
                    return;
                }
            }
            // CHECKSUM 3: STRICT title match - skip when author is locked (lock is stronger).
            // Only enforce title match when we have to rely on inferred trust.
            if (trustMode === 'inferred' && !this.strictTitleMatch(seriesTitle, book.item.title)) {
                console.log(`  Skipping Book ${bookNum}: Title does not contain all significant series words`);
                console.log(`    Series: "${seriesTitle}"`);
                console.log(`    Book: "${book.item.title}"`);
                /* merged with recordCandidate */
                this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'title_mismatch', book.item.releaseDate);
                return;
            }
            // Check pre-order setting
            if (settings.ignorePreorders && book.item.availability === 'preorder') {
                console.log(`  Skipping Book ${bookNum}: pre-order`);
                /* merged with recordCandidate */
                this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'preorder', book.item.releaseDate);
                return;
            }
            // AGE CHECK: reject books with release dates older than the configured threshold
            if (this.isBookTooOld(book.item.releaseDate, settings.maxBookAgeDays)) {
                console.log(`  Skipping Book ${bookNum}: Release date ${book.item.releaseDate} is older than ${settings.maxBookAgeDays} days`);
                this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, false, 'too_old', book.item.releaseDate);
                return;
            }
            // This is a genuinely NEW book!
            updates.push(this.createUpdate(newSnapshot.seriesId, seriesTitle, 'NEW_ITEM', newSnapshot.source, book.item, undefined, book.item.title));
            this.recordCandidate(book.item.title, book.item.author, bookNum, book.asin || undefined, true, undefined, book.item.releaseDate);
            console.log(`  ✅ NEW BOOK: #${bookNum} - ${book.item.title} by ${book.item.author} (ASIN: ${book.asin})`);
        });
        return updates;
    }
    /**
     * Extract book numbers and metadata from items
     */
    static extractBookData(items) {
        const books = items.map(item => ({
            item,
            // Use existing bookNumber from item (already extracted by scraper/parser)
            bookNumber: item.bookNumber !== undefined ? item.bookNumber : null,
            asin: extractAsin(item.url)
        }));
        // Find max book number
        const numberedBooks = books.filter(b => b.bookNumber !== null);
        const maxNumber = numberedBooks.length > 0
            ? Math.max(...numberedBooks.map(b => b.bookNumber))
            : 0;
        return { items: books, maxNumber };
    }
    /**
     * Calculate title similarity between series title and book title
     * Returns a score between 0 (no match) and 1 (perfect match)
     * Uses word-based similarity with common word filtering
     *
     * Strips parentheticals from series title (e.g., "The Land (Chaos Seeds)" → "The Land")
     * because parenthetical descriptors typically don't appear in book titles.
     */
    static calculateTitleSimilarity(seriesTitle, bookTitle) {
        // Strip parenthetical descriptors from series title
        // e.g., "The Land (Chaos Seeds)" -> "The Land"
        const cleanSeriesTitle = seriesTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        // Common words to ignore
        const commonWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'book', 'volume', 'series', 'part'
        ]);
        // Extract significant words (lowercase, > 2 chars, not common)
        const extractWords = (text) => {
            return new Set(text
                .toLowerCase()
                .replace(/[^\w\s]/g, ' ') // Remove punctuation
                .split(/\s+/)
                .filter(word => word.length > 2 && !commonWords.has(word)));
        };
        const seriesWords = extractWords(cleanSeriesTitle);
        const bookWords = extractWords(bookTitle);
        if (seriesWords.size === 0)
            return 1.0; // No words to compare, allow it
        // Calculate how many series words appear in book title
        let matches = 0;
        for (const seriesWord of seriesWords) {
            for (const bookWord of bookWords) {
                // Exact match or one word starts with the other (handles singular/plural)
                if (seriesWord === bookWord ||
                    seriesWord.startsWith(bookWord) ||
                    bookWord.startsWith(seriesWord)) {
                    matches++;
                    break;
                }
            }
        }
        // Return percentage of series words that matched
        return matches / seriesWords.size;
    }
    /**
     * STRICT title match - returns true only if ALL significant series words appear in book title.
     *
     * This is much stricter than calculateTitleSimilarity. For "Path of the Berserker" (significant
     * words: "path", "berserker"), a book titled "Path of Ascension" would FAIL this check because
     * "berserker" is not in the book title.
     *
     * Strips parentheticals from series title before comparison.
     */
    static strictTitleMatch(seriesTitle, bookTitle) {
        // Strip parenthetical descriptors from series title
        const cleanSeriesTitle = seriesTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        const commonWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'book', 'volume', 'series', 'part'
        ]);
        const extractWords = (text) => {
            return text
                .toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 2 && !commonWords.has(word));
        };
        const seriesWords = extractWords(cleanSeriesTitle);
        const bookWords = new Set(extractWords(bookTitle));
        // No significant words to compare = allow (rare edge case)
        if (seriesWords.length === 0)
            return true;
        // EVERY significant series word must appear in the book title
        for (const seriesWord of seriesWords) {
            let found = false;
            for (const bookWord of bookWords) {
                if (seriesWord === bookWord ||
                    seriesWord.startsWith(bookWord) ||
                    bookWord.startsWith(seriesWord)) {
                    found = true;
                    break;
                }
            }
            if (!found)
                return false;
        }
        return true;
    }
    /**
     * Normalize an author name for comparison.
     * - Lowercase
     * - Strip periods (so "J.A. Andrews" matches "JA Andrews")
     * - Collapse whitespace
     * - Trim
     * - Collapse fully-doubled names ("Actus Actus" → "Actus",
     *   "Mary Jane Mary Jane" → "Mary Jane"). This handles a known parser bug
     *   where Audible's HTML occasionally lists the same author name twice.
     */
    static normalizeAuthor(author) {
        let cleaned = author.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
        // Collapse fully-doubled token sequences (entire string repeated)
        const tokens = cleaned.split(' ');
        if (tokens.length > 0 && tokens.length % 2 === 0) {
            const half = tokens.length / 2;
            const first = tokens.slice(0, half);
            const second = tokens.slice(half);
            if (first.every((t, i) => t === second[i])) {
                cleaned = first.join(' ');
            }
        }
        return cleaned;
    }
    /**
     * Check whether a book's author field matches ANY trusted author.
     *
     * Audible often presents co-authored books as a comma- or ampersand-separated string
     * (e.g., "Tommy Kerper, SourpatchHero" or "TheFirstDefier & JF Brink").
     * This splits the book's author field on common separators and accepts a match
     * if ANY parsed name matches ANY trusted author.
     */
    static anyAuthorMatches(bookAuthorField, trustedAuthors) {
        if (!bookAuthorField || trustedAuthors.size === 0)
            return false;
        // Split on commas, ampersands, semicolons, and " and "
        const parts = bookAuthorField
            .split(/\s*[,;&]\s*|\s+and\s+/i)
            .map(p => this.normalizeAuthor(p))
            .filter(p => p.length > 0);
        // Also try the whole field as-is, in case the separator is part of a real name
        if (trustedAuthors.has(this.normalizeAuthor(bookAuthorField))) {
            return true;
        }
        return parts.some(part => trustedAuthors.has(part));
    }
    /**
     * Heuristic check for non-English titles.
     * Returns true if the title strongly appears to be in another language.
     *
     * Triggers on:
     * - Strong non-English characters (German umlauts, Polish/Czech diacritics, etc.)
     * - Multiple Romance-language accented characters (Spanish/Portuguese/French/Italian)
     * - Common foreign-language phrase patterns
     *
     * This is conservative — single accented characters in otherwise English titles
     * (e.g., "café", "naïve") will NOT trigger this filter.
     */
    static isLikelyNonEnglish(title) {
        if (!title)
            return false;
        // Strong indicators: characters that essentially never appear in English
        // - German: ä ö ü ß
        // - Polish: ą ę ł ń ś ź ż
        // - Czech/Slovak: č ď ě ň ř š ť ů ž
        // - Other Slavic: ć đ
        const strongNonEnglishChars = /[äöüßÄÖÜẞĄĘŁŃŚŹŻąęłńśźżčďěňřšťůžČĎĚŇŘŠŤŮŽćđĆĐ]/;
        if (strongNonEnglishChars.test(title)) {
            return true;
        }
        // Multiple Romance-language accented characters strongly suggests Spanish/
        // Portuguese/French/Italian. A single one (e.g., "café") is fine.
        const accentedMatches = title.match(/[áàâãéèêëíìîïóòôõúùûýÿñçÁÀÂÃÉÈÊËÍÌÎÏÓÒÔÕÚÙÛÝŸÑÇ]/g);
        if (accentedMatches && accentedMatches.length >= 2) {
            return true;
        }
        // Cyrillic, Greek, CJK, Arabic, Hebrew — anything outside Latin-1
        const nonLatinScript = /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;
        if (nonLatinScript.test(title)) {
            return true;
        }
        // Foreign-language definite articles at title start.
        // Conservative list — only patterns that essentially never appear at the start of English book titles.
        // (Excluded: La, Le, El, Der, Das, Die, Los, Las — all have English usage)
        const foreignArticleAtStart = /^(Il|Lo|Gli|Eine|Une)\s+\S/;
        if (foreignArticleAtStart.test(title)) {
            return true;
        }
        // Italian word-final contractions (apostrophe ending common Italian words).
        // "dell'anarchico", "nell'aria", "sull'isola", "all'arma", "coll'amore", "dall'alto"
        const italianContractions = /\b(dell|nell|sull|all|coll|dall)['']/i;
        if (italianContractions.test(title)) {
            return true;
        }
        // Romance-language elisions: short article/pronoun + apostrophe + letter.
        // Catches "L'amour", "d'Artagnan", "qu'on", "l'isola", "C'est"
        // English contractions ("I've", "it's", "don't") don't match because:
        //   - "I" is not in the letter set (intentionally — too risky)
        //   - Multi-letter English words ("it", "don") aren't "qu" and aren't single-letter
        const romanceElision = /(?:^|\s)(qu|[lLdDqQnNcCsS])['']([a-zA-Z])/i;
        if (romanceElision.test(title)) {
            return true;
        }
        // Italian-specific word endings that essentially never appear in English.
        // "-zione" / "-zioni" (nouns like rivelazione, azioni) — catches titles
        // like "La rivelazione" that have no diacritics and no article-based signal.
        const italianEndings = /\w(zione|zioni)\b/i;
        if (italianEndings.test(title)) {
            return true;
        }
        // Foreign-language grammar words with essentially zero English homographs or
        // naming collisions. Catches titles like "He Who Fights With Monsters - Die
        // Stadt der gefallenen Echos" — a translated subtitle tacked onto the English
        // series name, with no diacritics and no bracketed edition marker to catch it.
        // (Unlike the article-at-start check above, these are checked anywhere in the
        // title, since a translated subtitle usually follows a colon or dash.)
        const foreignStopwords = /\b(der|und|für|eine|einer|nicht|dass|sich|gegen|von|dans|avec|une|delle|senza|gli)\b/i;
        if (foreignStopwords.test(title)) {
            return true;
        }
        return false;
    }
    /**
     * Detects foreign-language edition variants whose titles are partly in English.
     *
     * Catches titles like:
     * - "Title (German Edition)" / "Title [Spanish Edition]"
     * - "Title (German Ausgabe)" / "Title (Édition française)"
     * - "Narración en Español Neutro"
     * - "Title (Castilian Spanish)"
     *
     * These slip past the `isLikelyNonEnglish` filter because the bulk of the title
     * is in English — only the parenthetical or trailing marker reveals it's a translation.
     */
    static isForeignEditionVariant(title) {
        if (!title)
            return false;
        const patterns = [
            // (German Edition), [Spanish Edition], etc. — English markers in brackets
            /[\(\[]\s*(German|French|Spanish|Italian|Portuguese|Brazilian|Japanese|Chinese|Korean|Russian|Dutch|Polish|Czech|Swedish|Norwegian|Danish|Finnish|Hungarian|Turkish|Greek|Hebrew|Arabic|Hindi|Indonesian|Thai|Vietnamese|Castilian|Latin\s+American|European)(\s+[\w\s]+)?\s+(Edition|Version|Translation|Ausgabe)\s*[\)\]]/i,
            // Non-English wording for "edition" inside parens/brackets
            /[\(\[]\s*Édition\s+\w+\s*[\)\]]/i,
            /[\(\[]\s*Edizione\s+\w+\s*[\)\]]/i,
            /[\(\[]\s*Edición\s+\w+\s*[\)\]]/i,
            /[\(\[]\s*Deutsche\s+Ausgabe\s*[\)\]]/i,
            // Free-standing localization markers (no brackets needed)
            /Narración en (Español|Spanish)/i,
            /(Spanish|Italian|French|German|Portuguese)\s+Narration/i,
            /Spanish\s+Castilian/i,
            /Castilian\s+Spanish/i,
        ];
        return patterns.some(p => p.test(title));
    }
    /**
     * Compare two items and detect changes
     * (Kept for other change types like date changes, price changes, etc.)
     */
    static compareItems(oldItem, newItem, seriesId, seriesTitle, source, settings) {
        const updates = [];
        // Date change
        if (this.shouldNotifyDateChange(oldItem, newItem, settings)) {
            updates.push(this.createUpdate(seriesId, seriesTitle, 'DATE_CHANGED', source, newItem, oldItem.releaseDateRaw || oldItem.releaseDate, newItem.releaseDateRaw || newItem.releaseDate));
        }
        // Availability change (preorder → available)
        if (oldItem.availability === 'preorder' &&
            newItem.availability === 'available') {
            updates.push(this.createUpdate(seriesId, seriesTitle, 'AVAILABILITY_CHANGED', source, newItem, oldItem.availability, newItem.availability));
        }
        return updates;
    }
    /**
     * Should we notify about a date change?
     */
    static shouldNotifyDateChange(oldItem, newItem, settings) {
        if (!oldItem.releaseDate || !newItem.releaseDate)
            return false;
        if (oldItem.releaseDate === newItem.releaseDate)
            return false;
        // Parse dates
        const oldDate = new Date(oldItem.releaseDate);
        const newDate = new Date(newItem.releaseDate);
        if (isNaN(oldDate.getTime()) || isNaN(newDate.getTime()))
            return false;
        // Check if change is significant (beyond threshold)
        const diffDays = Math.abs((newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= settings.dateShiftThreshold;
    }
    /**
     * Create an update object
     */
    static createUpdate(seriesId, seriesTitle, type, source, item, oldValue, newValue) {
        return {
            id: `${seriesId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            seriesId,
            seriesTitle,
            type,
            source,
            timestamp: Date.now(),
            bookTitle: item.title,
            bookUrl: item.url,
            bookNumber: item.bookNumber, // Propagate for lastNotifiedBookNumber tracking
            oldValue: oldValue || undefined,
            newValue: newValue || undefined,
            read: false,
            acknowledged: false
        };
    }
    /**
     * Get type emoji for display
     */
    static getTypeEmoji(type) {
        switch (type) {
            case 'NEW_ITEM': return '🆕';
            case 'DATE_CHANGED': return '📅';
            case 'AVAILABILITY_CHANGED': return '✅';
            case 'TITLE_CHANGED': return '✏️';
            case 'RUNTIME_CHANGED': return '⏱️';
            case 'NARRATOR_CHANGED': return '🎙️';
            default: return '📝';
        }
    }
    /**
     * Get type label for display
     */
    static getTypeLabel(type) {
        switch (type) {
            case 'NEW_ITEM': return 'New Book';
            case 'DATE_CHANGED': return 'Release Date Changed';
            case 'AVAILABILITY_CHANGED': return 'Now Available';
            case 'TITLE_CHANGED': return 'Title Changed';
            case 'RUNTIME_CHANGED': return 'Runtime Changed';
            case 'NARRATOR_CHANGED': return 'Narrator Changed';
            default: return 'Update';
        }
    }
    /**
     * Get update description (for backwards compatibility)
     */
    static getUpdateDescription(update) {
        return this.getTypeLabel(update.type);
    }
    /**
     * Get update icon (for backwards compatibility)
     */
    static getUpdateIcon(update) {
        return this.getTypeEmoji(update.type);
    }
}
/** Audit data from the most recent compareSnapshots call (per-thread, not concurrent-safe) */
DiffEngine.lastAudit = null;
