
import React from 'react';
import { IconComment } from './ui/icons';

const Header: React.FC = () => {
  return (
    <header className="py-12 text-center">
      <div className="animate-fade-in">
        <div className="flex items-center justify-center mb-4">
          <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-lg">
            <IconComment className="w-8 h-8" strokeWidth={1.5} />
          </div>
        </div>
        <h1 className="text-4xl font-light tracking-tight mb-2">
          Comment Harvester
        </h1>
        <div className="inline-block bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm mb-6">
          Discover insightful conversations
        </div>
        <p className="text-muted-foreground max-w-md mx-auto px-4">
          Search for topics and find the most relevant comments from around the web.
        </p>
      </div>
    </header>
  );
};

export default Header;
