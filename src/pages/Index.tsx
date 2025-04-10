// Modify handleSearch to fetch more comments and improve prioritization
const handleSearch = async (query: string, filterType: string) => {
  try {
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setActiveFilter(filterType);
    setSearchQuery(query);
    
    // Increase the fetch limit significantly
    const results = await searchComments(query, filterType, 100); // Fetch 100 comments
    
    // Additional filtering for quality
    const highQualityResults = results.filter(comment => {
      // Minimum quality criteria
      const hasSubstantialLength = comment.body.length > 100; // Longer comments
      const hasDecentUpvotes = comment.upvotes > 5; // Some community validation
      const notSpam = !comment.body.match(/(.)\1{4,}/g); // No repetitive characters
      
      return hasSubstantialLength && hasDecentUpvotes && notSpam;
    });
    
    setComments(highQualityResults);
    setIsLoading(false);
    
    // ... rest of the function remains the same ...
  } catch (err) {
    // ... error handling remains the same ...
  }
};
