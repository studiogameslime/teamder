jest.mock('react-native',()=>({Linking:{openSettings:jest.fn()}}));
jest.mock('@/components/AppDialog',()=>({appAlert:jest.fn()}));
jest.mock('@/i18n/he',()=>({he:{}}));
jest.mock('@/utils/errorObservation',()=>({observeCaughtError:jest.fn()}));
const mockLocation={Accuracy:{Balanced:3},getForegroundPermissionsAsync:jest.fn(),getCurrentPositionAsync:jest.fn(),reverseGeocodeAsync:jest.fn()};
jest.mock('expo-location',()=>mockLocation);
import {resolveNearbyLocation} from '@/utils/nearby';
import {observeCaughtError} from '@/utils/errorObservation';
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockLocation.getForegroundPermissionsAsync.mockResolvedValue({granted:true,canAskAgain:true});mockLocation.getCurrentPositionAsync.mockResolvedValue({coords:{latitude:31.8,longitude:34.8}});});
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});
test('Android missing country code keeps GPS and saved city without a false failure report',async()=>{
 mockLocation.reverseGeocodeAsync.mockRejectedValue(Error('java.lang.NullPointerException: getCountryCode(...) must not be null'));
 await expect(resolveNearbyLocation('עיר שמורה')).resolves.toMatchObject({latLng:{lat:31.8,lng:34.8},city:'עיר שמורה',granted:true});
 expect(observeCaughtError).not.toHaveBeenCalled();
});
test('other reverse geocoder errors remain visible and preserve GPS',async()=>{
 const error=Error('provider unavailable');mockLocation.reverseGeocodeAsync.mockRejectedValue(error);
 await expect(resolveNearbyLocation('עיר שמורה')).resolves.toMatchObject({latLng:{lat:31.8,lng:34.8},city:'עיר שמורה'});
 expect(observeCaughtError).toHaveBeenCalledWith(error,expect.objectContaining({site:'nearby:88fb261f2f'}));
});
