from pathlib import Path
import json
import re
import os
import sys
from typing import Optional, TypedDict, List, Dict, Any

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END

_AGENT_DIR = Path(__file__).resolve().parent

# Load environment variables from this directory or the project root.
# load_dotenv never overrides vars that are already set, so the local copy wins.
load_dotenv(_AGENT_DIR / ".env")
load_dotenv(_AGENT_DIR.parent.parent / ".env")


# Directory containing scraped JSON files, resolved relative to this file
SCRAPED_DATA_DIR: Path = _AGENT_DIR.parent / "chrome_extension" / "scraped_data"

# Matches filenames the server writes, e.g. "en.wikipedia.org_2025-09-18_19-44-17.json"
FILENAME_REGEX = re.compile(r"^.+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$")


def _find_latest_scraped_file(directory: Path) -> Optional[Path]:
    """Return the most recently modified scraped JSON file matching the pattern."""
    if not directory.exists():
        return None

    candidates = [
        path
        for path in directory.iterdir()
        if path.is_file() and FILENAME_REGEX.match(path.name)
    ]

    if not candidates:
        return None

    return max(candidates, key=lambda p: p.stat().st_mtime)


def _read_content_from_json(file_path: Path) -> str:
    """Read the "content" field from the given JSON file, or empty string if missing."""
    try:
        with file_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return str(data.get("content", ""))
        return ""
    except Exception:
        return ""


def get_latest_page_content() -> str:
    """Return the text content of the most recent scraped file, or empty string."""
    latest_file = _find_latest_scraped_file(SCRAPED_DATA_DIR)
    return _read_content_from_json(latest_file) if latest_file else ""


_llm: Optional[ChatOpenAI] = None


def get_llm() -> ChatOpenAI:
    """Return the shared LLM instance, creating it on first use."""
    global _llm
    if _llm is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY not found. Set it in the environment or in a .env "
                "file in the project root or Backend/AI Agent/."
            )
        _llm = ChatOpenAI(
            model="gpt-4o",
            temperature=0.3,
            api_key=api_key
        )
    return _llm

# Pydantic models for structured output
class AnalysisResult(BaseModel):
    theme: str
    mood: List[str]

class TaggedResult(BaseModel):
    tags: List[str]
    embedding_description: str

class MusicRecommendation(BaseModel):
    title: str
    artist: str
    match_reason: str
    search_query: str

class MusicRecommendations(BaseModel):
    recommendations: List[MusicRecommendation]

class AgentState(TypedDict):
    page_content: str
    analysis_result: Optional[Dict[str, Any]]
    tagged_result: Optional[Dict[str, Any]]
    music_recommendations: Optional[Dict[str, Any]]

CONTENT_ANALYZER_PROMPT = """You are an AI assistant that analyzes written text and extracts its thematic and emotional characteristics for music matching.

Follow these rules:
- Always summarize the main theme in 2 to 5 words.
- Always list moods as an array of 1 to 4 words.
- Always return output strictly in JSON format with keys: "theme" and "mood".

---

### Examples

Input:
"A spaceship crew lands on a distant planet filled with hostile alien life. The air is toxic, and the crew must struggle to survive."
Output:
{{
  "theme": "sci-fi survival",
  "mood": ["tense", "mysterious", "dark"]
}}

Input:
"A young couple walks hand in hand through the park, laughing as cherry blossoms fall around them."
Output:
{{
  "theme": "romantic slice of life",
  "mood": ["joyful", "peaceful"]
}}

Input:
"A knight faces a dragon guarding an ancient treasure deep within a cave. The clash is fierce, and the stakes are life or death."
Output:
{{
  "theme": "fantasy adventure",
  "mood": ["epic", "intense", "dramatic"]
}}

---

Now analyze the following input:

{page_content}

"""


EMBEDDING_TAGGING_PROMPT = """You are an AI assistant that converts thematic and emotional descriptors into compact tags and structured embeddings for music matching.

Input JSON:
{analysis_result}

Task:
1. Extract the "theme" and "mood" fields.
2. Generate a short list of 3 to 6 descriptive tags that capture both theme and mood.
   - Tags should be lowercase, single or two-word labels (e.g., "dark fantasy", "romantic", "epic", "calm").
   - Tags must avoid redundancy.
3. Provide an "embedding_description" that is a short natural language sentence summarizing the theme and mood in a way that can be converted into a vector.
   - Example: "Epic and dramatic fantasy adventure with intense atmosphere."

Output strictly in JSON format:
{{
  "tags": ["tag1", "tag2", "tag3", ...],
  "embedding_description": "short sentence for embedding"
}}

---

### Example

Input JSON:
{{
  "theme": "fantasy adventure",
  "mood": ["epic", "intense", "dramatic"]
}}

Output:
{{
  "tags": ["fantasy adventure", "epic", "intense", "dramatic"],
  "embedding_description": "Epic and dramatic fantasy adventure with intense atmosphere."
}}
"""


MUSIC_SELECTOR_PROMPT = """You are an AI assistant that recommends music tracks based on thematic and emotional descriptors. The tracks will be played by searching YouTube, so each recommendation must include a search query optimized for finding the song on YouTube.

Input JSON:
{tagged_result}

Task:
1. Interpret the "tags" and "embedding_description".
2. Select a list of 3-5 recommended songs that best match the theme and mood.
   - Prefer real, well-known tracks that are likely to exist on YouTube.
   - Each item must include: "title", "artist", "match_reason", and "search_query".
   - "search_query" should be a YouTube-friendly search string. Include the word "official" or "official audio" to bias toward the original recording instead of covers or lyric videos. Example: "Two Steps From Hell Dragon Rider official audio".
3. Output strictly in JSON format with this schema:

{{
  "recommendations": [
    {{
      "title": "string",
      "artist": "string",
      "match_reason": "string",
      "search_query": "string"
    }},
    ...
  ]
}}

---

### Example

Input JSON:
{{
  "tags": ["fantasy adventure", "epic", "intense", "dramatic"],
  "embedding_description": "Epic and dramatic fantasy adventure with intense atmosphere."
}}

Output:
{{
  "recommendations": [
    {{
      "title": "The Battle",
      "artist": "Harry Gregson-Williams",
      "match_reason": "Epic orchestral track with dramatic and intense mood, matching fantasy adventure theme.",
      "search_query": "Harry Gregson-Williams The Battle Narnia official audio"
    }},
    {{
      "title": "Dragon Rider",
      "artist": "Two Steps From Hell",
      "match_reason": "Epic trailer-style music with dramatic intensity fitting a fantasy adventure.",
      "search_query": "Two Steps From Hell Dragon Rider official"
    }}
  ]
}}
"""


# LangGraph node functions
def content_analyzer_node(state: AgentState) -> Dict[str, Any]:
    """Analyze the page content and extract theme and mood."""
    content = state.get('page_content', '')
    if not content:
        return {"analysis_result": {"theme": "unknown", "mood": []}}

    prompt = CONTENT_ANALYZER_PROMPT.format(page_content=content)

    messages = [
        SystemMessage(content="You are a helpful assistant that analyzes text and returns JSON."),
        HumanMessage(content=prompt)
    ]

    # Use structured output to get JSON response
    result = get_llm().with_structured_output(AnalysisResult).invoke(messages)

    return {
        "analysis_result": {
            "theme": result.theme,
            "mood": result.mood
        }
    }


def tag_node(state: AgentState) -> Dict[str, Any]:
    """Convert analysis result into tags and embedding description."""
    analysis = state.get('analysis_result')
    if not analysis:
        return {"tagged_result": {"tags": [], "embedding_description": ""}}

    # Convert analysis to JSON string for the prompt
    analysis_json = json.dumps(analysis, indent=2)
    prompt = EMBEDDING_TAGGING_PROMPT.format(analysis_result=analysis_json)

    messages = [
        SystemMessage(content="You are a helpful assistant that converts analysis into tags and returns JSON."),
        HumanMessage(content=prompt)
    ]

    # Use structured output to get JSON response
    result = get_llm().with_structured_output(TaggedResult).invoke(messages)

    return {
        "tagged_result": {
            "tags": result.tags,
            "embedding_description": result.embedding_description
        }
    }


def music_selector_node(state: AgentState) -> Dict[str, Any]:
    """Generate music recommendations with YouTube-ready search queries."""
    tagged = state.get('tagged_result')
    if not tagged:
        return {"music_recommendations": {"recommendations": []}}

    tagged_json = json.dumps(tagged, indent=2)
    prompt = MUSIC_SELECTOR_PROMPT.format(tagged_result=tagged_json)

    messages = [
        SystemMessage(content="You are a helpful assistant that recommends music and returns JSON."),
        HumanMessage(content=prompt)
    ]

    ai_recommendations = get_llm().with_structured_output(MusicRecommendations).invoke(messages)

    recommendations = [
        {
            "title": rec.title,
            "artist": rec.artist,
            "match_reason": rec.match_reason,
            "search_query": rec.search_query,
            "source": "ai_recommendation"
        }
        for rec in ai_recommendations.recommendations
    ]

    return {
        "music_recommendations": {
            "recommendations": recommendations
        }
    }


# Build the LangGraph workflow
def build_music_agent_graph():
    """Build and return the compiled LangGraph workflow."""
    builder = StateGraph(AgentState)

    # Add nodes
    builder.add_node("content_analyzer", content_analyzer_node)
    builder.add_node("tag", tag_node)
    builder.add_node("music_selector", music_selector_node)

    # Set entry point
    builder.set_entry_point("content_analyzer")

    # Add edges
    builder.add_edge("content_analyzer", "tag")
    builder.add_edge("tag", "music_selector")
    builder.add_edge("music_selector", END)

    # Compile the graph
    graph = builder.compile()
    return graph


# Create the graph instance
music_agent_graph = build_music_agent_graph()


def run_music_agent(content: Optional[str] = None) -> Dict[str, Any]:
    """
    Run the music agent workflow with the given content.

    Args:
        content: Optional content to analyze. If None, falls back to the most
            recently scraped file's content.

    Returns:
        Final state with all results including music recommendations.
    """
    input_content = content if content is not None else get_latest_page_content()

    if not input_content:
        return {
            "error": "No content provided. Please provide content or scrape a page first."
        }

    # Fail fast with a clear message if the API key is missing
    get_llm()

    initial_state = {
        "page_content": input_content,
        "analysis_result": None,
        "tagged_result": None,
        "music_recommendations": None
    }

    # Run the graph and collect all states
    final_state = initial_state.copy()
    for node_outputs in music_agent_graph.stream(initial_state):
        # Update final_state with outputs from each node
        for node_name, node_state in node_outputs.items():
            print(f"Node '{node_name}' completed", file=sys.stderr)
            final_state.update(node_state)

    return final_state
