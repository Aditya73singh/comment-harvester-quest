
import React from 'react';
import { Search, ArrowUp, MessageSquare, User, Hash, Calendar, Loader, Filter } from 'lucide-react';

export const IconSearch = (props: React.SVGProps<SVGSVGElement>) => <Search {...props} />;
export const IconUpvote = (props: React.SVGProps<SVGSVGElement>) => <ArrowUp {...props} />;
export const IconComment = (props: React.SVGProps<SVGSVGElement>) => <MessageSquare {...props} />;
export const IconUser = (props: React.SVGProps<SVGSVGElement>) => <User {...props} />;
export const IconSubreddit = (props: React.SVGProps<SVGSVGElement>) => <Hash {...props} />;
export const IconDate = (props: React.SVGProps<SVGSVGElement>) => <Calendar {...props} />;
export const IconLoader = (props: React.SVGProps<SVGSVGElement>) => <Loader {...props} />;
export const IconFilter = (props: React.SVGProps<SVGSVGElement>) => <Filter {...props} />;
