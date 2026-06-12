"""
Example usage of the Music Agent LangGraph workflow.

This script demonstrates how to use the music agent to analyze content
and get music recommendations.
"""

from ai_agent import run_music_agent, get_latest_page_content
import json

def main():
    """Run the music agent with example content."""

    # Example 1: Use the content from the most recent scraped file
    print("=" * 60)
    print("Example 1: Using content from scraped files")
    print("=" * 60)

    page_content = get_latest_page_content()
    if page_content:
        print(f"Found content ({len(page_content)} characters)")
        result = run_music_agent()
    else:
        print("No page_content found. Using example content...")
        
        # Example 2: Use custom content
        print("\n" + "=" * 60)
        print("Example 2: Using custom content")
        print("=" * 60)
        
        example_content = """
        A knight in shining armor rides through a dark forest, 
        the moonlight barely piercing through the thick canopy. 
        The air is heavy with mystery, and every rustle of leaves 
        could mean danger. The knight's sword gleams as they prepare 
        for an epic battle against an ancient dragon that guards 
        a legendary treasure deep within the mountains.
        """
        
        result = run_music_agent(example_content)
    
    # Print results
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    
    if "error" in result:
        print(f"Error: {result['error']}")
        return
    
    # Print analysis result
    if result.get("analysis_result"):
        print("\n📊 Analysis Result:")
        print(json.dumps(result["analysis_result"], indent=2))
    
    # Print tagged result
    if result.get("tagged_result"):
        print("\n🏷️  Tagged Result:")
        print(json.dumps(result["tagged_result"], indent=2))
    
    # Print music recommendations
    if result.get("music_recommendations"):
        print("\n🎵 Music Recommendations:")
        recommendations = result["music_recommendations"].get("recommendations", [])
        
        for i, rec in enumerate(recommendations, 1):
            print(f"\n  {i}. {rec.get('title', 'Unknown')} - {rec.get('artist', 'Unknown')}")
            print(f"     Reason: {rec.get('match_reason', 'N/A')}")
            if rec.get('search_query'):
                print(f"     YouTube search: {rec['search_query']}")
            print(f"     Source: {rec.get('source', 'unknown')}")

if __name__ == "__main__":
    main()

