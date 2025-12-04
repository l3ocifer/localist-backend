#!/usr/bin/env python3
"""Consolidate all venue JSON files and import into database."""
import json
import os
import sys
from collections import defaultdict

def consolidate_venues(venues_dir):
    all_venues = []
    seen_ids = set()
    city_counts = defaultdict(int)
    
    for f in sorted(os.listdir(venues_dir)):
        if f.endswith('.json') and f != 'consolidated-all-venues.json':
            filepath = os.path.join(venues_dir, f)
            try:
                with open(filepath) as fp:
                    venues = json.load(fp)
                    for v in venues:
                        # Create unique ID based on name and city
                        uid = f"{v.get('name', '')}_{v.get('city_id', '')}"
                        if uid not in seen_ids:
                            seen_ids.add(uid)
                            all_venues.append(v)
                            city_counts[v.get('city_id', 'unknown')] += 1
            except Exception as e:
                print(f'Error processing {f}: {e}')
    
    print(f'Total unique venues: {len(all_venues)}')
    print()
    print('By city:')
    for city, count in sorted(city_counts.items(), key=lambda x: -x[1]):
        print(f'  {city}: {count}')
    
    # Save consolidated file
    output_path = os.path.join(venues_dir, 'consolidated-all-venues.json')
    with open(output_path, 'w') as f:
        json.dump(all_venues, f, indent=2)
    print()
    print(f'Saved to {output_path}')
    
    return all_venues

if __name__ == '__main__':
    venues_dir = sys.argv[1] if len(sys.argv) > 1 else '/opt/localist/data/venues'
    consolidate_venues(venues_dir)

