import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  useListOrganizations,
  getListOrganizationsQueryKey
} from '@workspace/api-client-react';
import { Users, Search, Mail, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export default function Contractors() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const { data: contractors, isLoading } = useListOrganizations(
    { type: 'AN' }, 
    { query: { queryKey: getListOrganizationsQueryKey({ type: 'AN' }) } }
  );

  const filteredContractors = contractors?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.description && c.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contractors</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            View all available subcontractors (AN) in the network.
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 max-w-sm">
        <Search className="w-4 h-4 text-muted-foreground absolute ml-3" />
        <Input 
          placeholder="Search contractors..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-card"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : filteredContractors?.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl border-border bg-card/50">
          <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No contractors found</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            {search ? "No contractors match your search query." : "There are no subcontractor organizations available yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContractors?.map(contractor => (
            <Card key={contractor.id} className="bg-card hover:border-primary/30 transition-colors">
              <CardContent className="p-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {contractor.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg line-clamp-1">{contractor.name}</h3>
                      <div className="text-xs text-muted-foreground font-mono">ID: {contractor.id.substring(0,8)}</div>
                    </div>
                  </div>
                </div>

                {contractor.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-2 flex-1">
                    {contractor.description}
                  </p>
                )}

                <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                  {contractor.contactEmail ? (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Mail className="w-3.5 h-3.5 mr-2 opacity-70" />
                      <a href={`mailto:${contractor.contactEmail}`} className="hover:text-primary transition-colors">
                        {contractor.contactEmail}
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center text-sm text-muted-foreground/50 italic">
                      <Mail className="w-3.5 h-3.5 mr-2" />
                      No contact email
                    </div>
                  )}
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Building2 className="w-3.5 h-3.5 mr-2 opacity-70" />
                    Subcontractor (AN)
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
