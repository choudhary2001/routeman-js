import { Body, HttpCode, JsonController, Post, UnauthorizedError } from 'routing-controllers';
import { LoginDto } from '../dto/AuthDto';
import { userService } from '../services/UserService';
import { signToken } from '../services/TokenService';

@JsonController('/auth')
export class AuthController {
  @Post('/login')
  @HttpCode(200)
  login(@Body() credentials: LoginDto) {
    const user = userService.findByEmail(credentials.email);
    if (!user || user.password !== credentials.password) {
      throw new UnauthorizedError('Invalid email or password');
    }
    return { accessToken: signToken({ sub: user.id, role: user.role }) };
  }
}
