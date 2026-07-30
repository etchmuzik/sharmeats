import { describe, expectTypeOf, it } from 'vitest';
import type { Database, Json } from '../../../../packages/db-types/database.types';

type Functions = Database['public']['Functions'];
type ItemFlag = Database['public']['Enums']['item_flag_type'];

describe('generated merchant menu RPC types', () => {
  it('matches the public migration contract', () => {
    expectTypeOf<Functions['append_merchant_menu_section']>().toEqualTypeOf<{
      Args: {
        p_name: string;
        p_restaurant_id: string;
      };
      Returns: string;
    }>();

    expectTypeOf<Functions['append_merchant_menu_item']>().toEqualTypeOf<{
      Args: {
        p_description: string;
        p_flags: ItemFlag[];
        p_image: string;
        p_is_available: boolean;
        p_name: string;
        p_price_egp: number;
        p_restaurant_id: string;
        p_section_id: string;
      };
      Returns: string;
    }>();

    expectTypeOf<Functions['import_merchant_menu']>().toEqualTypeOf<{
      Args: {
        p_restaurant_id: string;
        p_rows: Json;
      };
      Returns: Json;
    }>();
  });
});
