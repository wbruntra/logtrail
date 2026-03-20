import axios from 'axios'
import { password } from './secrets'

const run = async () => {
  const response = await axios.post('https://logtrail2.lunaparkdigital.com/api/login', {
    password,
  })

  console.log('Login response:', response.data)
}

run()
