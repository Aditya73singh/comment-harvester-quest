
import React, { useState, useRef, useEffect } from 'react';
import { IconSearch } from './ui/icons';

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading = false }) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSearch(query.trim());
    }
  };

  useEffect(() => {
    // Auto-focus the search input on mount for desktop
    if (inputRef.current && window.innerWidth > 768) {
      inputRef.current.focus();
    }
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto mb-8 px-4">
      <form 
        onSubmit={handleSubmit}
        className={`search-container ${isFocused ? 'ring-2 ring-primary/30 shadow-lg' : 'shadow-md'} rounded-full transition-apple`}
      >
        <input
          ref={inputRef}
          type="text"
          className="search-input text-lg"
          placeholder="Search for comments..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={isLoading}
        />
        <button 
          type="submit"
          className="search-icon"
          disabled={isLoading || !query.trim()}
        >
          <IconSearch 
            className={`w-5 h-5 ${isLoading ? 'animate-pulse-light' : ''}`} 
            strokeWidth={1.5} 
          />
        </button>
      </form>
      <div className="text-center mt-2">
        <p className="text-sm text-muted-foreground">
          Try searching for "design", "technology", or "apple"
        </p>
      </div>
    </div>
  );
};

export default SearchBar;
