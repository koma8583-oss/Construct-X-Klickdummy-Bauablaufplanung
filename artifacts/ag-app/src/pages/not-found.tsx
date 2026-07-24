import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center animate-in fade-in duration-500">
      <Card className="max-w-md w-full border-border bg-card shadow-lg">
        <CardContent className="pt-10 pb-8 px-8 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          
          <h1 className="text-4xl font-bold tracking-tight mb-2">404</h1>
          <h2 className="text-xl font-semibold mb-4">Page not found</h2>
          
          <p className="text-muted-foreground mb-8 text-sm max-w-xs mx-auto">
            The page you are looking for doesn't exist or has been moved.
          </p>
          
          <Link href="/">
            <Button className="w-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Return to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
