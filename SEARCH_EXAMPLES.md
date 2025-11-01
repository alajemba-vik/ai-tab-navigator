# AI Tab Navigator - Search Examples

## Natural Language Support

The extension now intelligently handles full sentences and extracts meaningful keywords automatically.

### How It Works

The search system uses a **keyword extraction** algorithm that:
1. Removes common filler words (stop words)
2. Focuses on meaningful content words
3. Works with both AI and keyword search modes

### Stop Words (Automatically Filtered)

These words are automatically ignored:
- **Filler**: I, am, looking, for, find, show, search
- **Articles**: a, an, the
- **Prepositions**: in, on, at, to, from, with, of, about
- **Pronouns**: this, that, these, those, my, your
- **Common verbs**: is, are, was, were, be, want, need
- **Conjunctions**: and, or, but
- **Quantifiers**: some, any, all

### Example Queries

#### ✅ Natural Language (Now Supported!)

| User Types | Keywords Extracted | What Gets Searched |
|-----------|-------------------|-------------------|
| "I am looking for a tab about JavaScript" | `javascript` | JavaScript-related tabs |
| "find me tabs about machine learning" | `machine`, `learning` | Machine learning content |
| "show me my github repositories" | `github`, `repositories` | GitHub repo tabs |
| "I want to find my insurance documents" | `insurance`, `documents` | Insurance documents |
| "search for tabs related to brain research" | `brain`, `research` | Brain research tabs |

#### ✅ Direct Keywords (Always Worked)

| User Types | Keywords Extracted | What Gets Searched |
|-----------|-------------------|-------------------|
| "javascript" | `javascript` | JavaScript tabs |
| "machine learning" | `machine`, `learning` | ML-related tabs |
| "github" | `github` | GitHub tabs |

#### ✅ Hashtag Search (Fast Tag-Only)

| User Types | What Happens |
|-----------|-------------|
| "#programming" | Searches only tags, no keyword extraction |
| "#github #development" | Matches tabs with both tags |

### Search Modes

#### 1. **AI Search** (Default)
- Extracts keywords from natural language
- AI analyzes tab relevance with extracted keywords
- Smart scoring based on context
- Example: "I'm looking for JavaScript tutorials" → AI focuses on "javascript" and "tutorials"

#### 2. **Aggressive Search** (Toggle ON)
- Extracts keywords from natural language
- Scans full page content sequentially
- Shows results progressively as tabs are searched
- Example: "find tabs about brain research" → Deep scans for "brain" and "research"

#### 3. **Hashtag Search** (Use #)
- Bypasses keyword extraction
- Fast tag-only matching
- Example: "#development #javascript"

#### 4. **Keyword Fallback** (When AI unavailable)
- Extracts keywords from natural language
- Traditional title/URL/summary matching
- Example: "show me github tabs" → Searches for "github"

### Tips for Best Results

#### ✅ Good Queries

```
"I'm looking for tabs about React hooks"
"find me machine learning tutorials" 
"show my insurance policy documents"
"search for github repositories"
"brain research papers"
```

#### ⚠️ Queries That Are Just Stop Words

These will use all words (fallback):
```
"the and or" → All words kept
"I am" → All words kept
```

But this is rare - most queries have at least one meaningful word!

### Technical Details

**Keyword Extraction Function**: `extractKeywords(query)`

- **Input**: Raw user query (natural language or keywords)
- **Output**: Array of meaningful keywords
- **Logic**:
  1. Converts query to lowercase
  2. Splits into words
  3. Filters out stop words
  4. Keeps words > 2 characters
  5. Falls back to all words if none found

**Integration**:
- ✅ AI Search prompt: Instructs AI to focus on extracted keywords
- ✅ Aggressive Search: Uses keywords for scoring
- ✅ Keyword Fallback: Uses keywords for matching

### Example Console Logs

```
[KeywordExtract] Original query: I am looking for a tab about JavaScript tutorials
[KeywordExtract] Extracted keywords: ['javascript', 'tutorials']

[Search] Query: I am looking for a tab about JavaScript tutorials
[Search] Using keywords: ['javascript', 'tutorials']
[AI] Prompting AI for scored selection with extracted keywords
```

### Code Location

- **Keyword Extraction**: Line ~1588 in `popup.js`
- **AI Prompt Update**: Line ~1764 in `popup.js`
- **Aggressive Search**: Line ~1160 in `popup.js`
- **Fallback Search**: Line ~1622 in `popup.js`

---

**Result**: Users can now naturally type how they think, and the extension intelligently extracts what they're actually searching for! 🎉
